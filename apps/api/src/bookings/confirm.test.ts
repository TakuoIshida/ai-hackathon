import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import {
  availabilityLinks,
  availabilityRules,
  bookings,
  googleCalendars,
  googleOauthAccounts,
  tenants,
  users,
} from "@/db/schema";
import type { LinkWithRelations } from "@/links/domain";
import { findLinkBySlug } from "@/links/repo";
import {
  type BookingTestSinks,
  buildBookingTestSinks,
  buildTestGooglePort,
  toConfirmPorts,
} from "@/test/booking-ports";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { type ConfirmInput, type ConfirmResult, confirmBooking } from "./confirm";

const TZ = "Asia/Tokyo";
// Pick a Monday far enough in the future that Date.now() is always earlier.
// 2026-12-14 (Monday). 14:00 JST = 05:00 UTC.
const SLOT_START_ISO = "2026-12-14T05:00:00.000Z";
const SLOT_START_MS = Date.parse(SLOT_START_ISO);
const SLOT_END_MS = SLOT_START_MS + 30 * 60_000;

let testDb: TestDb;
let sinks: BookingTestSinks;

type SeededLink = {
  tenantId: string;
  userId: string;
  link: LinkWithRelations;
};

async function seedTenant(db: TestDb): Promise<string> {
  const [tenant] = await db.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed: tenant insert failed");
  return tenant.id;
}

async function seedPublishedLink(
  db: TestDb,
  overrides: { slug?: string } = {},
): Promise<SeededLink> {
  const tenantId = await seedTenant(db);
  const [user] = await db
    .insert(users)
    .values({ externalId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed: user insert failed");
  const slug = overrides.slug ?? "intro-30min";
  const [linkRow] = await db
    .insert(availabilityLinks)
    .values({
      tenantId,
      userId: user.id,
      slug,
      title: "30 min meeting",
      description: "intro chat",
      durationMinutes: 30,
      // Far horizon so the fixed test slot stays valid regardless of when the
      // suite runs (default 60 days would expire the slot below).
      rangeDays: 3650,
      timeZone: TZ,
    })
    .returning();
  if (!linkRow) throw new Error("seed: link insert failed");
  // Mon-Fri 9-17 JST — single multi-row INSERT (1 RTT vs 5 separate ones).
  await db.insert(availabilityRules).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      tenantId,
      linkId: linkRow.id,
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
  );
  // Use the @/db/client singleton (already swapped via setDbForTests) so the
  // Database type matches usecase signatures.
  const { db: clientDb } = await import("@/db/client");
  const link = await findLinkBySlug(clientDb, slug);
  if (!link) throw new Error("seed: published link not found after insert");
  return { tenantId, userId: user.id, link };
}

async function seedGoogleCalendar(db: TestDb, userId: string, tenantId: string): Promise<string> {
  const [account] = await db
    .insert(googleOauthAccounts)
    .values({
      tenantId,
      userId,
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
  if (!account) throw new Error("seed: oauth insert failed");
  await db.insert(googleCalendars).values({
    tenantId,
    oauthAccountId: account.id,
    googleCalendarId: "primary@example.com",
    summary: "Owner",
    timeZone: TZ,
    isPrimary: true,
    usedForBusy: true,
    usedForWrites: true,
  });
  return account.id;
}

const validInput = (): ConfirmInput => ({
  startMs: SLOT_START_MS,
  guestName: "Guest Name",
  guestEmail: "guest@example.com",
  guestNote: null,
  guestTimeZone: null,
});

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
    TRUNCATE TABLE tenant.bookings, tenant.availability_rules,
    tenant.availability_links, tenant.google_calendars, tenant.google_oauth_accounts,
    common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

describe("confirmBooking — happy path without Google", () => {
  test("inserts a confirmed booking and fires both confirmation emails", async () => {
    const seed = await seedPublishedLink(testDb);

    const result = await confirmBooking(db, seed.link, validInput(), toConfirmPorts(sinks, null));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.status).toBe("confirmed");
    expect(result.booking.startAt.getTime()).toBe(SLOT_START_MS);
    expect(result.booking.endAt.getTime()).toBe(SLOT_END_MS);
    expect(result.booking.guestEmail).toBe("guest@example.com");
    // No Google sync → no event id, no meet URL.
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
    expect(result.booking.cancellationToken).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);

    // ISH-123: usecase publishes a single domain event; the notifier adapter
    // is what fans it out to owner + guest emails.
    expect(sinks.notifyCalls.length).toBe(1);
    const event = sinks.notifyCalls[0];
    expect(event?.kind).toBe("booking_confirmed");
    if (event?.kind !== "booking_confirmed") throw new Error("unexpected event kind");
    expect(event.booking.id).toBe(result.booking.id);
    expect(event.cancellationToken).toBe(result.booking.cancellationToken);
    expect(event.owner.email).toBe("owner@example.com");
    expect(event.link.title).toBe("30 min meeting");

    // Owner + guest email rendered by the adapter.
    expect(sinks.sentEmails.length).toBe(2);
    expect(sinks.sentEmails.map((e) => e.to).sort()).toEqual([
      "guest@example.com",
      "owner@example.com",
    ]);
    // Cancel URL is built from the notifier's appBaseUrl + token.
    const guestEmail = sinks.sentEmails.find((e) => e.to === "guest@example.com");
    expect(guestEmail).toBeDefined();
    expect(guestEmail?.text).toContain(
      `https://app.test/cancel/${result.booking.cancellationToken}`,
    );
  });
});

describe("confirmBooking — Google integration", () => {
  test("publishes the event, persists googleEventId + meetUrl, and emails go out", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId, seed.tenantId);

    let createEventCalled = 0;
    let lastTitle: string | undefined;
    const google = buildTestGooglePort(db, {
      createEvent: async (input) => {
        createEventCalled += 1;
        lastTitle = input.title;
        return {
          id: "evt-google-1",
          meetUrl: "https://meet.google.com/abc-defg-hij",
          htmlLink: "https://example.com/evt-google-1",
        };
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), toConfirmPorts(sinks, google));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.googleEventId).toBe("evt-google-1");
    expect(result.booking.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    // ISH-269: htmlLink from events.insert is persisted on the booking so
    // the owner detail page can deeplink to the actual event.
    expect(result.booking.googleHtmlLink).toBe("https://example.com/evt-google-1");
    expect(createEventCalled).toBe(1);
    expect(lastTitle).toBe("30 min meeting");

    const [persisted] = await testDb
      .select()
      .from(bookings)
      .where(eq(bookings.id, result.booking.id));
    expect(persisted?.googleEventId).toBe("evt-google-1");
    expect(persisted?.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(persisted?.googleHtmlLink).toBe("https://example.com/evt-google-1");

    expect(sinks.sentEmails.length).toBe(2);
  });

  test("Google account not connected: booking succeeds without Google sync", async () => {
    // cfg is set but the user has no oauth account row → getOauthAccountByUser returns null.
    const seed = await seedPublishedLink(testDb);
    let createEventCalled = 0;
    const google = buildTestGooglePort(db, {
      createEvent: async () => {
        createEventCalled += 1;
        return { id: "should-not-be-used" };
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), toConfirmPorts(sinks, google));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(createEventCalled).toBe(0);
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
    expect(sinks.sentEmails.length).toBe(2);
  });

  test("createEvent throws — booking still stands (no rollback); googleEventId null", async () => {
    // Current behavior pin (ISH-130): the booking is committed BEFORE the
    // Google event is created, and the calendar sync block is wrapped in a
    // try/catch that only logs. So a createEvent failure leaves a confirmed
    // booking with no googleEventId / meetUrl. If this should change in the
    // future (e.g. retry queue) it belongs in a separate PR.
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId, seed.tenantId);

    let createEventCalls = 0;
    const google = buildTestGooglePort(db, {
      createEvent: async () => {
        createEventCalls += 1;
        throw new Error("calendar boom");
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), toConfirmPorts(sinks, google));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    // Booking persisted, but without googleEventId / meetUrl / googleHtmlLink.
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
    expect(result.booking.googleHtmlLink).toBeNull();
    expect(createEventCalls).toBe(1);

    const [persisted] = await testDb
      .select()
      .from(bookings)
      .where(eq(bookings.id, result.booking.id));
    expect(persisted?.status).toBe("confirmed");
    expect(persisted?.googleEventId).toBeNull();
    expect(persisted?.meetUrl).toBeNull();
    expect(persisted?.googleHtmlLink).toBeNull();

    // Email side-effects still ran.
    expect(sinks.sentEmails.length).toBe(2);
  });

  test("getValidAccessToken throws — booking still stands (no rollback)", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId, seed.tenantId);

    let createEventCalls = 0;
    const google = buildTestGooglePort(db, {
      getValidAccessToken: async () => {
        throw new Error("token boom");
      },
      createEvent: async () => {
        createEventCalls += 1;
        return { id: "evt-x" };
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), toConfirmPorts(sinks, google));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(createEventCalls).toBe(0);
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
  });
});

describe("confirmBooking — notifications resilience", () => {
  test("sendEmail throws — booking is still committed (best-effort policy)", async () => {
    const seed = await seedPublishedLink(testDb);

    const failingSinks = buildBookingTestSinks(db, {
      sendEmail: async () => {
        throw new Error("smtp boom");
      },
    });
    const result = await confirmBooking(
      db,
      seed.link,
      validInput(),
      toConfirmPorts(failingSinks, null),
    );

    expect(result.kind).toBe("ok");
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("confirmed");
  });

  test("notifier.notify throws — booking is still committed (usecase swallows)", async () => {
    const seed = await seedPublishedLink(testDb);

    const ports = toConfirmPorts(sinks, null);
    const result = await confirmBooking(db, seed.link, validInput(), {
      ...ports,
      notifier: {
        notify: async () => {
          throw new Error("notifier boom");
        },
      },
    });

    expect(result.kind).toBe("ok");
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("confirmed");
  });
});

describe("confirmBooking — slot conflict / availability guards", () => {
  test("slot outside availability window → kind:'slot_unavailable'", async () => {
    const seed = await seedPublishedLink(testDb);
    // Sunday 2026-12-13 — outside Mon-Fri windows.
    const sundayMs = Date.parse("2026-12-13T05:00:00.000Z");
    const result = await confirmBooking(
      db,
      seed.link,
      {
        startMs: sundayMs,
        guestName: "Guest",
        guestEmail: "guest@example.com",
        guestNote: null,
        guestTimeZone: null,
      },
      toConfirmPorts(sinks, null),
    );

    expect(result.kind).toBe("slot_unavailable");
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(0);
    expect(sinks.sentEmails.length).toBe(0);
  });

  test("dual-booking same slot → kind:'race_lost' (409 shape) and only one row exists", async () => {
    const seed = await seedPublishedLink(testDb);

    const first = await confirmBooking(db, seed.link, validInput(), toConfirmPorts(sinks, null));
    expect(first.kind).toBe("ok");

    const second: ConfirmResult = await confirmBooking(
      db,
      seed.link,
      { ...validInput(), guestEmail: "different@example.com" },
      toConfirmPorts(sinks, null),
    );

    expect(second.kind).toBe("race_lost");

    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.guestEmail).toBe("guest@example.com");
  });
});
