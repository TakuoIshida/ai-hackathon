import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { availabilityLinks, bookings, users } from "@/db/schema";
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
    TRUNCATE TABLE bookings, availability_excludes, availability_rules,
    availability_links, google_calendars, google_oauth_accounts, users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedLink(): Promise<{ userId: string; linkId: string }> {
  const [user] = await testDb
    .insert(users)
    .values({ clerkId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed user");
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      userId: user.id,
      slug: `slug-${randomUUID()}`,
      title: "30 min meeting",
      durationMinutes: 30,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link");
  return { userId: user.id, linkId: link.id };
}

function bookingInput(
  linkId: string,
  overrides: Partial<NewBookingRow> = {},
): Omit<NewBookingRow, "id" | "status" | "createdAt"> & { status?: never } {
  return {
    linkId,
    startAt: SLOT_START,
    endAt: SLOT_END,
    guestName: "Guest A",
    guestEmail: "guest-a@example.com",
    ...overrides,
  } as Omit<NewBookingRow, "id" | "status" | "createdAt"> & { status?: never };
}

describe("bookings/repo", () => {
  test("tryInsertConfirmedBooking inserts and returns the new row (happy path)", async () => {
    const { linkId } = await seedLink();
    const created = await tryInsertConfirmedBooking(db, bookingInput(linkId));
    expect(created).not.toBeNull();
    expect(created?.linkId).toBe(linkId);
    expect(created?.status).toBe("confirmed");
    expect(created?.startAt.toISOString()).toBe(SLOT_START.toISOString());
    expect(created?.endAt.toISOString()).toBe(SLOT_END.toISOString());
    expect(created?.guestEmail).toBe("guest-a@example.com");
    // cancellationToken is auto-generated
    expect(created?.cancellationToken).toMatch(/^[0-9a-f-]{36}$/);

    const persisted = await testDb.select().from(bookings).where(eq(bookings.linkId, linkId));
    expect(persisted.length).toBe(1);
  });

  test("sequential insert into the same (link, slot) returns null on second attempt", async () => {
    const { linkId } = await seedLink();
    const first = await tryInsertConfirmedBooking(db, bookingInput(linkId));
    expect(first).not.toBeNull();
    const second = await tryInsertConfirmedBooking(
      db,
      bookingInput(linkId, { guestEmail: "different@example.com" }),
    );
    // Partial unique index `uniq_bookings_active_slot` rejects via ON CONFLICT DO NOTHING.
    expect(second).toBeNull();

    const rows = await testDb.select().from(bookings).where(eq(bookings.linkId, linkId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.guestEmail).toBe("guest-a@example.com");
  });

  test("Promise.all parallel inserts: exactly one wins, the other returns null (race guard)", async () => {
    const { linkId } = await seedLink();

    // Fire both inserts truly concurrently via Promise.all. The partial unique
    // index must serialize them at the storage layer so that exactly one of
    // the two onConflictDoNothing inserts succeeds.
    //
    // Note on PGlite vs production Postgres:
    //   PGlite executes statements sequentially through a single WASM connection,
    //   so in practice the two inserts never overlap — but the unique-index
    //   contract is identical to upstream Postgres. If both inserts targeted
    //   the same partial unique key in real concurrent sessions, exactly one
    //   would commit and the other would either get a duplicate-key error
    //   (without ON CONFLICT) or — as here — a no-op insert returning zero
    //   rows. So the assertion of "exactly one fulfilled with a row, exactly
    //   one fulfilled with null" is the same observable contract a real
    //   concurrent client would see.
    const results = await Promise.allSettled([
      tryInsertConfirmedBooking(db, bookingInput(linkId, { guestEmail: "racer-1@example.com" })),
      tryInsertConfirmedBooking(db, bookingInput(linkId, { guestEmail: "racer-2@example.com" })),
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
    const rows = await testDb.select().from(bookings).where(eq(bookings.linkId, linkId));
    expect(rows.length).toBe(1);
    const persisted = rows[0];
    if (!persisted) throw new Error("expected exactly one persisted row");
    expect(["racer-1@example.com", "racer-2@example.com"]).toContain(persisted.guestEmail);
    // The persisted row corresponds to the winner.
    expect(persisted.id).toBe(winners[0]?.id ?? "");
  });

  test("attachGoogleEvent sets googleEventId and meetUrl on the row", async () => {
    const { linkId } = await seedLink();
    const created = await tryInsertConfirmedBooking(db, bookingInput(linkId));
    if (!created) throw new Error("precondition: insert should succeed");

    await attachGoogleEvent(
      db,
      created.id,
      "evt-google-123",
      "https://meet.google.com/abc-defg-hij",
    );

    const reloaded = await findBookingById(db, created.id);
    expect(reloaded?.googleEventId).toBe("evt-google-123");
    expect(reloaded?.meetUrl).toBe("https://meet.google.com/abc-defg-hij");

    // Also accepts a null meetUrl (no Meet attached).
    await attachGoogleEvent(db, created.id, "evt-google-456", null);
    const reloaded2 = await findBookingById(db, created.id);
    expect(reloaded2?.googleEventId).toBe("evt-google-456");
    expect(reloaded2?.meetUrl).toBeNull();
  });

  test("findActiveBookingsForLink returns rows scoped to the given linkId", async () => {
    const linkA = await seedLink();
    const linkB = await seedLink();

    const aBooking = await tryInsertConfirmedBooking(
      db,
      bookingInput(linkA.linkId, { guestEmail: "a@example.com" }),
    );
    const bBooking = await tryInsertConfirmedBooking(
      db,
      bookingInput(linkB.linkId, { guestEmail: "b@example.com" }),
    );
    expect(aBooking).not.toBeNull();
    expect(bBooking).not.toBeNull();

    const aRows = await findActiveBookingsForLink(db, linkA.linkId);
    expect(aRows.length).toBe(1);
    expect(aRows[0]?.guestEmail).toBe("a@example.com");

    const bRows = await findActiveBookingsForLink(db, linkB.linkId);
    expect(bRows.length).toBe(1);
    expect(bRows[0]?.guestEmail).toBe("b@example.com");

    // Unknown linkId → empty array.
    const empty = await findActiveBookingsForLink(db, randomUUID());
    expect(empty.length).toBe(0);
  });

  test("findBookingById returns the inserted row, or null when missing", async () => {
    const { linkId } = await seedLink();
    const created = await tryInsertConfirmedBooking(db, bookingInput(linkId));
    if (!created) throw new Error("precondition: insert should succeed");

    const found = await findBookingById(db, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.linkId).toBe(linkId);
    expect(found?.guestEmail).toBe("guest-a@example.com");

    const missing = await findBookingById(db, randomUUID());
    expect(missing).toBeNull();
  });

  test("markBookingCanceled frees the slot so re-insert into the same (link, slot) succeeds", async () => {
    const { linkId } = await seedLink();
    const first = await tryInsertConfirmedBooking(db, bookingInput(linkId));
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
      bookingInput(linkId, { guestEmail: "second-attempt@example.com" }),
    );
    expect(rebook).not.toBeNull();
    expect(rebook?.status).toBe("confirmed");
    expect(rebook?.guestEmail).toBe("second-attempt@example.com");

    const allRows = await testDb.select().from(bookings).where(eq(bookings.linkId, linkId));
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
      const { linkId } = await seedLink();
      const start = new Date(NOW.getTime() + LEAD_MS);
      const created = await tryInsertConfirmedBooking(
        db,
        bookingInput(linkId, {
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
      expect(due[0]?.linkId).toBe(linkId);
      expect(due[0]?.guestEmail).toBe("guest-a@example.com");
      expect(due[0]?.cancellationToken).toBe(created.cancellationToken);
    });

    test("excludes canceled bookings even if otherwise in window", async () => {
      const { linkId } = await seedLink();
      const start = new Date(NOW.getTime() + LEAD_MS);
      const created = await tryInsertConfirmedBooking(
        db,
        bookingInput(linkId, {
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
      const { linkId } = await seedLink();
      // start_at = now + lead - window - 1min (i.e. 9 min too early)
      const start = new Date(NOW.getTime() + LEAD_MS - WINDOW_MS - 60_000);
      await tryInsertConfirmedBooking(
        db,
        bookingInput(linkId, {
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
      const { linkId } = await seedLink();
      // start_at = now + lead + window (exclusive upper bound)
      const start = new Date(NOW.getTime() + LEAD_MS + WINDOW_MS);
      await tryInsertConfirmedBooking(
        db,
        bookingInput(linkId, {
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
      const { linkId } = await seedLink();
      const start = new Date(NOW.getTime() + LEAD_MS);
      const created = await tryInsertConfirmedBooking(
        db,
        bookingInput(linkId, {
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
      const { linkId } = await seedLink();
      const created = await tryInsertConfirmedBooking(db, bookingInput(linkId));
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
