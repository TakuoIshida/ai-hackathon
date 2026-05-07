import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { availabilityLinks, availabilityRules, bookings, tenants, users } from "@/db/schema";
import {
  type BookingTestSinks,
  buildBookingTestSinks,
  buildTestGooglePort,
} from "@/test/booking-ports";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { type RescheduleBookingPorts, rescheduleBooking } from "./reschedule";

const TZ = "Asia/Tokyo";
// Far-future Monday (2026-12-14) 14:00 JST → 05:00 UTC.
const ORIGINAL_START_ISO = "2026-12-14T05:00:00.000Z";
const ORIGINAL_END_ISO = "2026-12-14T05:30:00.000Z";
// New slot: same Monday 15:00 JST → 06:00 UTC, also Mon-Fri 9-17 JST window.
const NEW_START_ISO = "2026-12-14T06:00:00.000Z";
const NEW_END_ISO = "2026-12-14T06:30:00.000Z";

let testDb: TestDb;
let sinks: BookingTestSinks;

beforeAll(async () => {
  testDb = await createTestDb();
  setDbForTests(testDb);
}, 30_000);

afterAll(async () => {
  clearDbForTests();
  await testDb.$client.close();
});

beforeEach(async () => {
  sinks = buildBookingTestSinks(db);
  await testDb.$client.exec(`
    TRUNCATE TABLE tenant.bookings, tenant.availability_excludes, tenant.availability_rules,
    tenant.availability_links, tenant.google_calendars, tenant.google_oauth_accounts,
    common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

type Seeded = {
  tenantId: string;
  userId: string;
  linkId: string;
  bookingId: string;
};

async function seedConfirmedBookingWithLink(): Promise<Seeded> {
  const [tenant] = await testDb.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed tenant");
  const [user] = await testDb
    .insert(users)
    .values({ externalId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed user");
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      tenantId: tenant.id,
      userId: user.id,
      slug: `slug-${randomUUID()}`,
      title: "30 min meeting",
      durationMinutes: 30,
      // Far horizon so the fixed test slot stays valid.
      rangeDays: 3650,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link");
  // Mon-Fri 9-17 JST so both ORIGINAL and NEW slots fall inside availability.
  await testDb.insert(availabilityRules).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      tenantId: tenant.id,
      linkId: link.id,
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
  );
  const [booking] = await testDb
    .insert(bookings)
    .values({
      tenantId: tenant.id,
      linkId: link.id,
      hostUserId: user.id,
      startAt: new Date(ORIGINAL_START_ISO),
      endAt: new Date(ORIGINAL_END_ISO),
      guestName: "Guest",
      guestEmail: "guest@example.com",
      status: "confirmed",
    })
    .returning();
  if (!booking) throw new Error("seed booking");
  return {
    tenantId: tenant.id,
    userId: user.id,
    linkId: link.id,
    bookingId: booking.id,
  };
}

function toPorts(s: BookingTestSinks): RescheduleBookingPorts {
  return {
    google: null,
    links: s.links,
    availability: s.availability,
    users: s.users,
    notifier: s.notifier,
  };
}

describe("rescheduleBooking — happy paths", () => {
  test("moves a confirmed booking to a new in-window slot and emails go out", async () => {
    const seed = await seedConfirmedBookingWithLink();

    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      toPorts(sinks),
      // Pin "now" before the original slot so the state check passes regardless
      // of when the suite runs.
      new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.startAt.toISOString()).toBe(NEW_START_ISO);
    expect(result.booking.endAt.toISOString()).toBe(NEW_END_ISO);
    expect(result.booking.status).toBe("confirmed");
    expect(result.previousStartAt.toISOString()).toBe(ORIGINAL_START_ISO);

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.startAt.toISOString()).toBe(NEW_START_ISO);
    expect(row?.endAt.toISOString()).toBe(NEW_END_ISO);
    expect(row?.status).toBe("confirmed");

    // ISH-270: notifier published exactly one reschedule event with both slots.
    expect(sinks.notifyCalls.length).toBe(1);
    const event = sinks.notifyCalls[0];
    expect(event?.kind).toBe("booking_rescheduled");
    if (event?.kind !== "booking_rescheduled") throw new Error("wrong event kind");
    expect(event.previousStartAt.toISOString()).toBe(ORIGINAL_START_ISO);
    expect(event.booking.startAt.toISOString()).toBe(NEW_START_ISO);

    // Owner + guest email rendered by the adapter.
    expect(sinks.sentEmails.length).toBe(2);
    expect(sinks.sentEmails.map((e) => e.to).sort()).toEqual([
      "guest@example.com",
      "owner@example.com",
    ]);
    for (const e of sinks.sentEmails) expect(e.subject).toContain("予約変更");
  });
});

describe("rescheduleBooking — auth / state guards", () => {
  test("not_found when booking id does not exist", async () => {
    const result = await rescheduleBooking(
      db,
      randomUUID(),
      randomUUID(),
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      toPorts(sinks),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("not_found");
  });

  test("not_found when booking is owned by another user (no info-leak)", async () => {
    const seed = await seedConfirmedBookingWithLink();
    const [intruder] = await testDb
      .insert(users)
      .values({ externalId: `clerk_${randomUUID()}`, email: "intruder@example.com" })
      .returning();
    if (!intruder) throw new Error("seed intruder");
    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      intruder.id,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      toPorts(sinks),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("not_found");
    // Booking row untouched.
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.startAt.toISOString()).toBe(ORIGINAL_START_ISO);
    expect(sinks.sentEmails.length).toBe(0);
  });

  test("not_reschedulable when status is canceled", async () => {
    const seed = await seedConfirmedBookingWithLink();
    await testDb
      .update(bookings)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(bookings.id, seed.bookingId));
    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      toPorts(sinks),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("not_reschedulable");
    expect(sinks.sentEmails.length).toBe(0);
  });

  test("not_reschedulable when the booking has already started (startAt < now)", async () => {
    const seed = await seedConfirmedBookingWithLink();
    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      toPorts(sinks),
      // "Now" is well after the original slot.
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("not_reschedulable");
  });
});

describe("rescheduleBooking — availability re-check", () => {
  test("availability_violation when new slot falls outside the link's rules", async () => {
    const seed = await seedConfirmedBookingWithLink();
    // Sunday 2026-12-13 — outside Mon-Fri windows.
    const sundayMs = Date.parse("2026-12-13T05:00:00.000Z");
    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: sundayMs, endMs: sundayMs + 30 * 60_000 },
      toPorts(sinks),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("availability_violation");
    // DB unchanged.
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.startAt.toISOString()).toBe(ORIGINAL_START_ISO);
    expect(sinks.sentEmails.length).toBe(0);
  });

  test("availability_violation when the duration does not match the link", async () => {
    const seed = await seedConfirmedBookingWithLink();
    // Same start, but 60 minutes (link is 30) → mismatch.
    const startMs = Date.parse(NEW_START_ISO);
    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs, endMs: startMs + 60 * 60_000 },
      toPorts(sinks),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("availability_violation");
  });
});

describe("rescheduleBooking — slot conflict", () => {
  test("slot_already_booked when another confirmed booking occupies the new slot", async () => {
    const seed = await seedConfirmedBookingWithLink();
    // Seed a second confirmed booking on the same link at the NEW slot.
    await testDb.insert(bookings).values({
      tenantId: seed.tenantId,
      linkId: seed.linkId,
      hostUserId: seed.userId,
      startAt: new Date(NEW_START_ISO),
      endAt: new Date(NEW_END_ISO),
      guestName: "Other",
      guestEmail: "other@example.com",
      status: "confirmed",
    });

    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      toPorts(sinks),
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("slot_already_booked");
    // Original booking untouched.
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.startAt.toISOString()).toBe(ORIGINAL_START_ISO);
  });
});

describe("rescheduleBooking — Google patch resilience", () => {
  test("patch failure does not roll back the DB update (best-effort)", async () => {
    const seed = await seedConfirmedBookingWithLink();
    // Mark the booking as having a Google event so the patch path engages.
    await testDb
      .update(bookings)
      .set({ googleEventId: "evt-1" })
      .where(eq(bookings.id, seed.bookingId));
    // Need an oauth account + write calendar so the helper reaches the patch.
    const { googleOauthAccounts, googleCalendars } = await import("@/db/schema");
    const [acct] = await testDb
      .insert(googleOauthAccounts)
      .values({
        tenantId: seed.tenantId,
        userId: seed.userId,
        googleUserId: `g_${randomUUID()}`,
        email: "owner@example.com",
        encryptedRefreshToken: "ct",
        refreshTokenIv: "iv",
        refreshTokenAuthTag: "tag",
        accessToken: "at",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "calendar.events",
      })
      .returning();
    if (!acct) throw new Error("seed oauth");
    await testDb.insert(googleCalendars).values({
      tenantId: seed.tenantId,
      oauthAccountId: acct.id,
      googleCalendarId: "primary@example.com",
      summary: "Owner",
      timeZone: TZ,
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: true,
    });

    const google = buildTestGooglePort(db, {
      patchEvent: async () => {
        throw new Error("calendar patch boom");
      },
    });

    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      { ...toPorts(sinks), google },
      new Date("2026-01-01T00:00:00Z"),
    );

    expect(result.kind).toBe("ok");
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.startAt.toISOString()).toBe(NEW_START_ISO);
    expect(sinks.sentEmails.length).toBe(2);
  });

  test("patch success refreshes googleHtmlLink without clobbering googleEventId", async () => {
    const seed = await seedConfirmedBookingWithLink();
    await testDb
      .update(bookings)
      .set({
        googleEventId: "evt-1",
        googleHtmlLink: "https://example.com/old",
        meetUrl: "https://meet.google.com/abc",
      })
      .where(eq(bookings.id, seed.bookingId));
    const { googleOauthAccounts, googleCalendars } = await import("@/db/schema");
    const [acct] = await testDb
      .insert(googleOauthAccounts)
      .values({
        tenantId: seed.tenantId,
        userId: seed.userId,
        googleUserId: `g_${randomUUID()}`,
        email: "owner@example.com",
        encryptedRefreshToken: "ct",
        refreshTokenIv: "iv",
        refreshTokenAuthTag: "tag",
        accessToken: "at",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "calendar.events",
      })
      .returning();
    if (!acct) throw new Error("seed oauth");
    await testDb.insert(googleCalendars).values({
      tenantId: seed.tenantId,
      oauthAccountId: acct.id,
      googleCalendarId: "primary@example.com",
      summary: "Owner",
      timeZone: TZ,
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: true,
    });

    let patchCalls = 0;
    const google = buildTestGooglePort(db, {
      patchEvent: async (input) => {
        patchCalls += 1;
        expect(input.eventId).toBe("evt-1");
        expect(input.startMs).toBe(Date.parse(NEW_START_ISO));
        return { id: "evt-1", htmlLink: "https://example.com/new" };
      },
    });

    const result = await rescheduleBooking(
      db,
      seed.bookingId,
      seed.userId,
      { startMs: Date.parse(NEW_START_ISO), endMs: Date.parse(NEW_END_ISO) },
      { ...toPorts(sinks), google },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(result.kind).toBe("ok");
    expect(patchCalls).toBe(1);

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.googleEventId).toBe("evt-1");
    expect(row?.meetUrl).toBe("https://meet.google.com/abc");
    expect(row?.googleHtmlLink).toBe("https://example.com/new");
  });
});
