import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { availabilityLinks, bookings, tenants, users } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/integration-db";
import {
  attachGoogleEvent,
  findActiveBookingsForLink,
  findBookingById,
  findBookingsDueForReminder,
  markBookingCanceled,
  markReminderSent,
  type NewBookingRow,
  tryInsertConfirmedBooking,
} from "./repo";

const TZ = "Asia/Tokyo";
// Far-future Monday (2026-12-14) 14:00 JST → 05:00 UTC.
const SLOT_START = new Date("2026-12-14T05:00:00.000Z");
const SLOT_END = new Date("2026-12-14T05:30:00.000Z");

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  setDbForTests(testDb);
}, 30_000);

afterAll(async () => {
  clearDbForTests();
  await testDb.$client.close();
});

beforeEach(async () => {
  await testDb.$client.exec(`
    TRUNCATE TABLE tenant.bookings, tenant.availability_excludes, tenant.availability_rules,
    tenant.availability_links, tenant.google_calendars, tenant.google_oauth_accounts,
    common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedLink(): Promise<{ userId: string; linkId: string; tenantId: string }> {
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
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link");
  return { userId: user.id, linkId: link.id, tenantId: tenant.id };
}

function bookingInput(
  seed: { linkId: string; tenantId: string; userId: string },
  overrides: Partial<NewBookingRow> = {},
): Omit<NewBookingRow, "id" | "status" | "createdAt"> & { status?: never } {
  return {
    tenantId: seed.tenantId,
    linkId: seed.linkId,
    // ISH-267: host_user_id is NOT NULL — every insert in production carries
    // the parent link's primary owner as host. The seed reuses that user.
    hostUserId: seed.userId,
    startAt: SLOT_START,
    endAt: SLOT_END,
    guestName: "Guest A",
    guestEmail: "guest-a@example.com",
    ...overrides,
  } as Omit<NewBookingRow, "id" | "status" | "createdAt"> & { status?: never };
}

describe("bookings/repo", () => {
  test("tryInsertConfirmedBooking inserts and returns the new row (happy path)", async () => {
    const seed = await seedLink();
    const created = await tryInsertConfirmedBooking(db, bookingInput(seed));
    expect(created).not.toBeNull();
    expect(created?.linkId).toBe(seed.linkId);
    expect(created?.status).toBe("confirmed");
    expect(created?.startAt.toISOString()).toBe(SLOT_START.toISOString());
    expect(created?.endAt.toISOString()).toBe(SLOT_END.toISOString());
    expect(created?.guestEmail).toBe("guest-a@example.com");
    // cancellationToken is auto-generated
    expect(created?.cancellationToken).toMatch(/^[0-9a-f-]{36}$/);

    const persisted = await testDb.select().from(bookings).where(eq(bookings.linkId, seed.linkId));
    expect(persisted.length).toBe(1);
  });

  test("sequential insert into the same (link, slot) returns null on second attempt", async () => {
    const seed = await seedLink();
    const first = await tryInsertConfirmedBooking(db, bookingInput(seed));
    expect(first).not.toBeNull();
    const second = await tryInsertConfirmedBooking(
      db,
      bookingInput(seed, { guestEmail: "different@example.com" }),
    );
    // Partial unique index `uniq_bookings_active_slot` rejects via ON CONFLICT DO NOTHING.
    expect(second).toBeNull();

    const rows = await testDb.select().from(bookings).where(eq(bookings.linkId, seed.linkId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.guestEmail).toBe("guest-a@example.com");
  });

  test("Promise.all parallel inserts: exactly one wins, the other returns null (race guard)", async () => {
    const seed = await seedLink();

    // Fire both inserts truly concurrently via Promise.all. The partial unique
    // index must serialize them at the storage layer so that exactly one of
    // the two onConflictDoNothing inserts succeeds. The test harness now runs
    // against a real Postgres over TCP, so this exercises the same locking
    // path production sees: exactly one commit, the other is a no-op insert
    // returning zero rows.
    const results = await Promise.allSettled([
      tryInsertConfirmedBooking(db, bookingInput(seed, { guestEmail: "racer-1@example.com" })),
      tryInsertConfirmedBooking(db, bookingInput(seed, { guestEmail: "racer-2@example.com" })),
    ]);

    expect(results.length).toBe(2);
    // Both must settle (no rejection — onConflictDoNothing is the contract).
    for (const r of results) expect(r.status).toBe("fulfilled");

    const values = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const winners = values.filter((v) => v !== null);
    const losers = values.filter((v) => v === null);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);

    // Only one row persisted.
    const rows = await testDb.select().from(bookings).where(eq(bookings.linkId, seed.linkId));
    expect(rows.length).toBe(1);
    const persisted = rows[0];
    if (!persisted) throw new Error("expected exactly one persisted row");
    expect(["racer-1@example.com", "racer-2@example.com"]).toContain(persisted.guestEmail);
    // The persisted row corresponds to the winner.
    expect(persisted.id).toBe(winners[0]?.id ?? "");
  });

  test("attachGoogleEvent sets googleEventId, meetUrl and googleHtmlLink on the row", async () => {
    const seed = await seedLink();
    const created = await tryInsertConfirmedBooking(db, bookingInput(seed));
    if (!created) throw new Error("precondition: insert should succeed");

    await attachGoogleEvent(
      db,
      created.id,
      "evt-google-123",
      "https://meet.google.com/abc-defg-hij",
      "https://www.google.com/calendar/event?eid=evt-google-123",
    );

    const reloaded = await findBookingById(db, created.id);
    expect(reloaded?.googleEventId).toBe("evt-google-123");
    expect(reloaded?.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    // ISH-269: htmlLink persisted alongside event id so the booking detail
    // page can deeplink straight to the actual Google Calendar event.
    expect(reloaded?.googleHtmlLink).toBe(
      "https://www.google.com/calendar/event?eid=evt-google-123",
    );

    // Also accepts a null meetUrl + null htmlLink (no Meet, no link returned).
    await attachGoogleEvent(db, created.id, "evt-google-456", null, null);
    const reloaded2 = await findBookingById(db, created.id);
    expect(reloaded2?.googleEventId).toBe("evt-google-456");
    expect(reloaded2?.meetUrl).toBeNull();
    expect(reloaded2?.googleHtmlLink).toBeNull();
  });

  test("findActiveBookingsForLink returns rows scoped to the given linkId", async () => {
    const seedA = await seedLink();
    const seedB = await seedLink();

    const aBooking = await tryInsertConfirmedBooking(
      db,
      bookingInput(seedA, { guestEmail: "a@example.com" }),
    );
    const bBooking = await tryInsertConfirmedBooking(
      db,
      bookingInput(seedB, { guestEmail: "b@example.com" }),
    );
    expect(aBooking).not.toBeNull();
    expect(bBooking).not.toBeNull();

    const aRows = await findActiveBookingsForLink(db, seedA.linkId);
    expect(aRows.length).toBe(1);
    expect(aRows[0]?.guestEmail).toBe("a@example.com");

    const bRows = await findActiveBookingsForLink(db, seedB.linkId);
    expect(bRows.length).toBe(1);
    expect(bRows[0]?.guestEmail).toBe("b@example.com");

    // Unknown linkId → empty array.
    const empty = await findActiveBookingsForLink(db, randomUUID());
    expect(empty.length).toBe(0);
  });

  test("findBookingById returns the inserted row, or null when missing", async () => {
    const seed = await seedLink();
    const created = await tryInsertConfirmedBooking(db, bookingInput(seed));
    if (!created) throw new Error("precondition: insert should succeed");

    const found = await findBookingById(db, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.linkId).toBe(seed.linkId);
    expect(found?.guestEmail).toBe("guest-a@example.com");

    const missing = await findBookingById(db, randomUUID());
    expect(missing).toBeNull();
  });

  test("markBookingCanceled frees the slot so re-insert into the same (link, slot) succeeds", async () => {
    const seed = await seedLink();
    const first = await tryInsertConfirmedBooking(db, bookingInput(seed));
    if (!first) throw new Error("precondition: first insert should succeed");

    const canceled = await markBookingCanceled(db, first.id);
    expect(canceled?.id).toBe(first.id);
    expect(canceled?.status).toBe("canceled");
    expect(canceled?.canceledAt).not.toBeNull();

    // Second cancel of the same booking is a no-op (returns null).
    const second = await markBookingCanceled(db, first.id);
    expect(second).toBeNull();

    // Re-booking the same (link_id, start_at) should now succeed because the
    // partial unique index only covers status='confirmed' rows.
    const rebook = await tryInsertConfirmedBooking(
      db,
      bookingInput(seed, { guestEmail: "second-attempt@example.com" }),
    );
    expect(rebook).not.toBeNull();
    expect(rebook?.status).toBe("confirmed");
    expect(rebook?.guestEmail).toBe("second-attempt@example.com");

    const allRows = await testDb.select().from(bookings).where(eq(bookings.linkId, seed.linkId));
    expect(allRows.length).toBe(2);
    const statuses = allRows.map((r) => r.status).sort();
    expect(statuses).toEqual(["canceled", "confirmed"]);
  });

  // ---------- ISH-98: reminder cron repo helpers ----------

  describe("findBookingsDueForReminder", () => {
    // Reference clock: a stable fake "now". The reminder fires 24h ahead of
    // start_at, so a booking starting at NOW + 24h with reminder_sent_at NULL
    // is the canonical "in window" case. Window half-width: 8 minutes.
    const NOW = new Date("2026-01-10T00:00:00.000Z");
    const LEAD_MS = 24 * 60 * 60 * 1000;
    const WINDOW_MS = 8 * 60 * 1000;

    test("returns confirmed, unsent booking whose start_at is at the reminder mark", async () => {
      const seed = await seedLink();
      const start = new Date(NOW.getTime() + LEAD_MS);
      const created = await tryInsertConfirmedBooking(
        db,
        bookingInput(seed, {
          startAt: start,
          endAt: new Date(start.getTime() + 30 * 60 * 1000),
        }),
      );
      if (!created) throw new Error("precondition: insert");

      const due = await findBookingsDueForReminder(db, {
        now: NOW,
        leadMs: LEAD_MS,
        windowMs: WINDOW_MS,
      });
      expect(due.length).toBe(1);
      expect(due[0]?.bookingId).toBe(created.id);
      expect(due[0]?.linkId).toBe(seed.linkId);
      expect(due[0]?.guestEmail).toBe("guest-a@example.com");
      expect(due[0]?.cancellationToken).toBe(created.cancellationToken);
      // ISH-149: link/owner fields are projected via JOIN so the cron job
      // doesn't need a per-booking SELECT to render the notification body.
      expect(due[0]?.linkTitle).toBe("30 min meeting");
      expect(due[0]?.linkTimeZone).toBe("Asia/Tokyo");
      expect(due[0]?.ownerEmail).toBe("owner@example.com");
    });

    test("excludes canceled bookings even if otherwise in window", async () => {
      const seed = await seedLink();
      const start = new Date(NOW.getTime() + LEAD_MS);
      const created = await tryInsertConfirmedBooking(
        db,
        bookingInput(seed, {
          startAt: start,
          endAt: new Date(start.getTime() + 30 * 60 * 1000),
        }),
      );
      if (!created) throw new Error("precondition: insert");
      await markBookingCanceled(db, created.id);

      const due = await findBookingsDueForReminder(db, {
        now: NOW,
        leadMs: LEAD_MS,
        windowMs: WINDOW_MS,
      });
      expect(due.length).toBe(0);
    });

    test("excludes bookings where start_at is too early (before window lower bound)", async () => {
      const seed = await seedLink();
      // start_at = now + lead - window - 1min (i.e. 9 min too early)
      const start = new Date(NOW.getTime() + LEAD_MS - WINDOW_MS - 60_000);
      await tryInsertConfirmedBooking(
        db,
        bookingInput(seed, {
          startAt: start,
          endAt: new Date(start.getTime() + 30 * 60 * 1000),
        }),
      );
      const due = await findBookingsDueForReminder(db, {
        now: NOW,
        leadMs: LEAD_MS,
        windowMs: WINDOW_MS,
      });
      expect(due.length).toBe(0);
    });

    test("excludes bookings where start_at is too late (at/beyond window upper bound)", async () => {
      const seed = await seedLink();
      // start_at = now + lead + window (exclusive upper bound)
      const start = new Date(NOW.getTime() + LEAD_MS + WINDOW_MS);
      await tryInsertConfirmedBooking(
        db,
        bookingInput(seed, {
          startAt: start,
          endAt: new Date(start.getTime() + 30 * 60 * 1000),
        }),
      );
      const due = await findBookingsDueForReminder(db, {
        now: NOW,
        leadMs: LEAD_MS,
        windowMs: WINDOW_MS,
      });
      expect(due.length).toBe(0);
    });

    test("excludes bookings whose reminder_sent_at is already populated", async () => {
      const seed = await seedLink();
      const start = new Date(NOW.getTime() + LEAD_MS);
      const created = await tryInsertConfirmedBooking(
        db,
        bookingInput(seed, {
          startAt: start,
          endAt: new Date(start.getTime() + 30 * 60 * 1000),
        }),
      );
      if (!created) throw new Error("precondition: insert");
      await testDb
        .update(bookings)
        .set({ reminderSentAt: new Date(NOW.getTime() - 60_000) })
        .where(eq(bookings.id, created.id));

      const due = await findBookingsDueForReminder(db, {
        now: NOW,
        leadMs: LEAD_MS,
        windowMs: WINDOW_MS,
      });
      expect(due.length).toBe(0);
    });
  });

  describe("markReminderSent", () => {
    const NOW = new Date("2026-01-10T00:00:00.000Z");

    test("returns true on first call and stamps reminder_sent_at; second call returns false and preserves the original timestamp", async () => {
      const seed = await seedLink();
      const created = await tryInsertConfirmedBooking(db, bookingInput(seed));
      if (!created) throw new Error("precondition: insert");

      const first = await markReminderSent(db, created.id, NOW);
      expect(first).toBe(true);

      const afterFirst = await findBookingById(db, created.id);
      expect(afterFirst?.reminderSentAt?.toISOString()).toBe(NOW.toISOString());

      // Second call: race-pin. Must NOT bump the timestamp — the partial WHERE
      // clause must short-circuit so concurrent overlapping cron workers can
      // never re-stamp (and therefore re-send).
      const later = new Date(NOW.getTime() + 5 * 60_000);
      const second = await markReminderSent(db, created.id, later);
      expect(second).toBe(false);

      const afterSecond = await findBookingById(db, created.id);
      expect(afterSecond?.reminderSentAt?.toISOString()).toBe(NOW.toISOString());
    });
  });
});
