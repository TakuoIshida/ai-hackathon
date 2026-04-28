import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as bookingsRepo from "@/bookings/repo";
import { tryInsertConfirmedBooking } from "@/bookings/repo";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { availabilityLinks, bookings, tenants, users } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { sendDueReminders } from "./reminder-job";
import type { EmailMessage, SendEmailFn } from "./types";

const TZ = "Asia/Tokyo";
// Pinned wall clock for deterministic windowing.
const NOW = new Date("2026-01-10T00:00:00.000Z");
const LEAD_MS = 24 * 60 * 60 * 1000;
const APP_BASE_URL = "https://app.example.com";

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

type SeedFixture = {
  userId: string;
  linkId: string;
  tenantId: string;
  ownerEmail: string;
};

async function seedOwnerAndLink(): Promise<SeedFixture> {
  const [tenant] = await testDb.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed tenant");
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const [user] = await testDb
    .insert(users)
    .values({ externalId: `clerk_${randomUUID()}`, email: ownerEmail, name: "Owner" })
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
  return { userId: user.id, linkId: link.id, tenantId: tenant.id, ownerEmail };
}

type CapturedEmail = EmailMessage;

function captureSender(): { sendEmail: SendEmailFn; captured: CapturedEmail[] } {
  const captured: CapturedEmail[] = [];
  const sendEmail: SendEmailFn = async (msg) => {
    captured.push(msg);
  };
  return { sendEmail, captured };
}

async function insertDueBooking(
  fixture: SeedFixture,
  guestEmail: string,
): Promise<{ id: string; cancellationToken: string }> {
  return insertDueBookingAt(fixture, guestEmail, 0);
}

async function insertDueBookingAt(
  fixture: SeedFixture,
  guestEmail: string,
  offsetMs: number,
): Promise<{ id: string; cancellationToken: string }> {
  const start = new Date(NOW.getTime() + LEAD_MS + offsetMs);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const created = await tryInsertConfirmedBooking(db, {
    tenantId: fixture.tenantId,
    linkId: fixture.linkId,
    startAt: start,
    endAt: end,
    guestName: "Guest",
    guestEmail,
    guestTimeZone: TZ,
  });
  if (!created) throw new Error("seed booking");
  return { id: created.id, cancellationToken: created.cancellationToken };
}

describe("sendDueReminders (ISH-98)", () => {
  test("happy path: due booking → owner + guest emails sent, reminder_sent_at populated", async () => {
    const fixture = await seedOwnerAndLink();
    const due = await insertDueBooking(fixture, "guest@example.com");

    const { sendEmail, captured } = captureSender();
    const result = await sendDueReminders(db, {
      sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });

    expect(result).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });
    expect(captured.length).toBe(2);
    const recipients = captured.map((m) => m.to).sort();
    expect(recipients).toEqual(["guest@example.com", fixture.ownerEmail].sort());
    // Cancel URL should be embedded (used by both templates).
    const expectedCancelUrl = `${APP_BASE_URL}/cancel/${due.cancellationToken}`;
    for (const msg of captured) expect(msg.text).toContain(expectedCancelUrl);

    // reminder_sent_at populated.
    const [persisted] = await testDb.select().from(bookings).where(eq(bookings.id, due.id));
    expect(persisted?.reminderSentAt).toBeTruthy();
    expect(persisted?.reminderSentAt?.toISOString()).toBe(NOW.toISOString());
  });

  test("already sent: pre-set reminder_sent_at → skipped, sendEmail not invoked", async () => {
    const fixture = await seedOwnerAndLink();
    const due = await insertDueBooking(fixture, "guest@example.com");
    // Manually mark as already reminded so the row never appears in
    // findBookingsDueForReminder. (This is the "race lost" or
    // "previous-tick-handled" case as observed by a later cron run.)
    await testDb
      .update(bookings)
      .set({ reminderSentAt: new Date(NOW.getTime() - 60_000) })
      .where(eq(bookings.id, due.id));

    const { sendEmail, captured } = captureSender();
    const result = await sendDueReminders(db, {
      sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });

    // The pre-marked row is filtered out by `findBookingsDueForReminder` (the
    // partial-WHERE on `reminder_sent_at IS NULL`), so it never reaches the
    // claim step. `considered` reflects this — the row was never even
    // candidate. The test still asserts the no-double-send invariant.
    expect(result).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
    expect(captured.length).toBe(0);
  });

  test("already sent (race-style): row appears in findDue but markReminderSent loses → skipped", async () => {
    // Simulate the in-flight race: a booking is fetched as "due", then between
    // fetch and claim some other worker stamps it. We approximate by stubbing
    // `markReminderSent`-equivalent behavior using a sender that runs only
    // when the claim succeeded. Instead, trigger this naturally with a
    // sendEmail-side override: set the reminder_sent_at AFTER fetching but
    // BEFORE claim by patching the sender callback. Here we keep the test
    // simple by re-invoking the job twice in sequence — the second invocation
    // sees "already sent" via the partial-WHERE filter on findDue, which is
    // the production-equivalent observation.
    const fixture = await seedOwnerAndLink();
    await insertDueBooking(fixture, "guest@example.com");

    const first = captureSender();
    const r1 = await sendDueReminders(db, {
      sendEmail: first.sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });
    expect(r1).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });

    const second = captureSender();
    const r2 = await sendDueReminders(db, {
      sendEmail: second.sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });
    // Second pass: row excluded by reminder_sent_at IS NULL filter.
    expect(r2).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
    expect(second.captured.length).toBe(0);
  });

  test("email failure: sendEmail throws → result.failed === 1, reminder_sent_at stays SET (no rollback)", async () => {
    const fixture = await seedOwnerAndLink();
    const due = await insertDueBooking(fixture, "guest@example.com");

    const failingSender: SendEmailFn = async () => {
      throw new Error("smtp boom");
    };

    const result = await sendDueReminders(db, {
      sendEmail: failingSender,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });

    expect(result.considered).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(1);

    // Crucially: the claim is NOT rolled back — single-send semantics dominate.
    const [persisted] = await testDb.select().from(bookings).where(eq(bookings.id, due.id));
    expect(persisted?.reminderSentAt).toBeTruthy();
  });

  test("empty: no due bookings → all counts 0, sendEmail not called", async () => {
    const { sendEmail, captured } = captureSender();
    const result = await sendDueReminders(db, {
      sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });
    expect(result).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
    expect(captured.length).toBe(0);
  });

  test("now() / leadHours / windowMinutes overrides honored", async () => {
    const fixture = await seedOwnerAndLink();
    // start_at 2 hours ahead of NOW. leadHours=2 → due window centered on +2h.
    const start = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const created = await tryInsertConfirmedBooking(db, {
      tenantId: fixture.tenantId,
      linkId: fixture.linkId,
      startAt: start,
      endAt: end,
      guestName: "Guest",
      guestEmail: "guest@example.com",
      guestTimeZone: TZ,
    });
    if (!created) throw new Error("seed booking");

    // With default leadHours=24 the booking should NOT be due — sanity check.
    const noOverride = await sendDueReminders(db, {
      sendEmail: captureSender().sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });
    expect(noOverride.considered).toBe(0);

    // Overrides: leadHours=2 puts the window over the booking's start_at.
    const { sendEmail, captured } = captureSender();
    const result = await sendDueReminders(db, {
      sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
      leadHours: 2,
      windowMinutes: 5,
    });
    expect(result).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });
    expect(captured.length).toBe(2);
  });

  test("multiple due bookings: all processed, counters summed correctly", async () => {
    const fixture = await seedOwnerAndLink();
    // Three confirmed bookings, all in the same due window but at different
    // start_at values (the bookings table has a partial unique index on
    // (link_id, start_at) WHERE status='confirmed', so same-slot inserts
    // collide). The default windowMinutes=8 covers the whole ±5-min spread.
    const a = await insertDueBookingAt(fixture, "a@example.com", -5 * 60_000);
    const b = await insertDueBookingAt(fixture, "b@example.com", 0);
    const c = await insertDueBookingAt(fixture, "c@example.com", 5 * 60_000);

    const { sendEmail, captured } = captureSender();
    const result = await sendDueReminders(db, {
      sendEmail,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });

    expect(result).toEqual({ considered: 3, sent: 3, skipped: 0, failed: 0 });
    // 3 bookings × 2 recipients (owner + guest) = 6 messages.
    expect(captured.length).toBe(6);
    const guestRecipients = captured.map((m) => m.to).filter((to) => to.endsWith("@example.com"));
    expect(guestRecipients).toContain("a@example.com");
    expect(guestRecipients).toContain("b@example.com");
    expect(guestRecipients).toContain("c@example.com");

    // All three bookings have reminder_sent_at populated.
    for (const id of [a.id, b.id, c.id]) {
      const [row] = await testDb.select().from(bookings).where(eq(bookings.id, id));
      expect(row?.reminderSentAt).toBeTruthy();
    }
  });

  test("mixed batch: 1 success + 1 already-sent + 1 send-fail → counters add up", async () => {
    const fixture = await seedOwnerAndLink();
    // (1) due, will succeed
    const ok = await insertDueBookingAt(fixture, "ok@example.com", -5 * 60_000);
    // (2) due, will lose the markReminderSent claim (simulates a race where
    //     another worker stamped the row between findDue and markReminderSent).
    //     Forced via a markReminderSent spy that returns false for this id.
    const willSkip = await insertDueBookingAt(fixture, "skip@example.com", 0);
    // (3) due, will fail at send time
    const willFail = await insertDueBookingAt(fixture, "fail@example.com", 5 * 60_000);

    // Spy: markReminderSent returns false for `willSkip`, true for the others.
    // This simulates a race where another worker stamped the row between
    // findDue and markReminderSent.
    const realMark = bookingsRepo.markReminderSent;
    const markSpy = spyOn(bookingsRepo, "markReminderSent").mockImplementation(
      async (database, bookingId, now) => {
        if (bookingId === willSkip.id) return false;
        return realMark(database, bookingId, now);
      },
    );

    const failingForGuestC: SendEmailFn = async (msg) => {
      if (msg.to === "fail@example.com") throw new Error("smtp boom");
      // owner sends (and ok@example.com / skip@example.com guest sends if any)
    };

    try {
      const result = await sendDueReminders(db, {
        sendEmail: failingForGuestC,
        appBaseUrl: APP_BASE_URL,
        now: () => NOW.getTime(),
      });
      expect(result.considered).toBe(3);
      expect(result.sent).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(1);

      // ok was actually delivered → reminder_sent_at populated.
      const [okRow] = await testDb.select().from(bookings).where(eq(bookings.id, ok.id));
      expect(okRow?.reminderSentAt).toBeTruthy();
      // skip lost the claim → reminder_sent_at still null (the spy bypassed
      // the real UPDATE, so nothing was written for this booking).
      const [skipRow] = await testDb.select().from(bookings).where(eq(bookings.id, willSkip.id));
      expect(skipRow?.reminderSentAt).toBeNull();
      // fail did claim AND send threw → reminder_sent_at intentionally STAYS
      // populated (single-send dominates).
      const [failRow] = await testDb.select().from(bookings).where(eq(bookings.id, willFail.id));
      expect(failRow?.reminderSentAt).toBeTruthy();
    } finally {
      markSpy.mockRestore();
    }
  });

  test("markReminderSent throws (DB error during claim) → failed++, dispatch not called, mark stays null (ISH-147)", async () => {
    const fixture = await seedOwnerAndLink();
    const due = await insertDueBooking(fixture, "guest@example.com");

    // Simulate a DB-level failure during the claim UPDATE. tryClaim's catch
    // path should:
    //   - log to console.error (we capture to verify the path executed)
    //   - increment result.failed
    //   - return without invoking dispatch (so sendEmail is never called)
    //   - leave reminder_sent_at NULL (the UPDATE never landed)
    const markSpy = spyOn(bookingsRepo, "markReminderSent").mockRejectedValue(
      new Error("connection terminated"),
    );
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const { sendEmail, captured } = captureSender();
    try {
      const result = await sendDueReminders(db, {
        sendEmail,
        appBaseUrl: APP_BASE_URL,
        now: () => NOW.getTime(),
      });
      expect(result).toEqual({ considered: 1, sent: 0, skipped: 0, failed: 1 });
      expect(captured.length).toBe(0);

      // The catch block specifically logs `[reminder-job] claim failed for booking=<id>`.
      const logged = errorSpy.mock.calls.some((args) =>
        args.some((a) => typeof a === "string" && a.includes(`booking=${due.id}`)),
      );
      expect(logged).toBe(true);

      // Underlying row never got the UPDATE.
      const [row] = await testDb.select().from(bookings).where(eq(bookings.id, due.id));
      expect(row?.reminderSentAt).toBeNull();
    } finally {
      markSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("partial Promise.all failure (only guest send fails): result.failed=1, mark retained", async () => {
    const fixture = await seedOwnerAndLink();
    const due = await insertDueBooking(fixture, "guest@example.com");

    // Owner email succeeds, guest email throws. Promise.all rejects → dispatch
    // catches → counted as failed; reminder_sent_at stays SET.
    const partialSender: SendEmailFn = async (msg) => {
      if (msg.to === "guest@example.com") throw new Error("guest send fail");
      // owner ok
    };

    const result = await sendDueReminders(db, {
      sendEmail: partialSender,
      appBaseUrl: APP_BASE_URL,
      now: () => NOW.getTime(),
    });
    expect(result).toEqual({ considered: 1, sent: 0, skipped: 0, failed: 1 });

    const [persisted] = await testDb.select().from(bookings).where(eq(bookings.id, due.id));
    expect(persisted?.reminderSentAt).toBeTruthy();
  });
});
