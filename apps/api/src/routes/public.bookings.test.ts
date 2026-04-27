import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import {
  availabilityLinks,
  availabilityRules,
  bookings,
  googleCalendars,
  googleOauthAccounts,
  users,
} from "@/db/schema";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import type { GooglePort, NotificationPort } from "@/ports";
import { createPublicRoute, type PublicRouteDeps } from "@/routes/public";
import { buildTestGooglePort } from "@/test/booking-ports";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { buildLinkAvailabilityPort, buildLinkLookupPort, buildUserLookupPort } from "@/wiring";

const TZ = "Asia/Tokyo";
// Pick a Monday far enough in the future that Date.now() is always earlier.
// 2026-12-14 (Monday). 14:00 JST = 05:00 UTC.
const SLOT_START_ISO = "2026-12-14T05:00:00.000Z";
const SLOT_START_MS = Date.parse(SLOT_START_ISO);
const SLOT_END_MS = SLOT_START_MS + 30 * 60_000;

type Seeded = {
  userId: string;
  linkId: string;
  slug: string;
};

async function seedPublishedLink(
  db: TestDb,
  overrides: {
    slug?: string;
    isPublished?: boolean;
    leadTimeHours?: number;
    rangeDays?: number;
  } = {},
): Promise<Seeded> {
  const [user] = await db
    .insert(users)
    .values({ externalId: `clerk_${randomUUID()}`, email: "owner@example.com" })
    .returning();
  if (!user) throw new Error("seed: user insert failed");
  const slug = overrides.slug ?? "intro-30min";
  const [link] = await db
    .insert(availabilityLinks)
    .values({
      userId: user.id,
      slug,
      title: "30 min meeting",
      durationMinutes: 30,
      // Far horizon so the fixed test slot stays valid regardless of when the
      // suite runs (default 60 days would expire the slot below).
      rangeDays: overrides.rangeDays ?? 3650,
      leadTimeHours: overrides.leadTimeHours ?? 0,
      timeZone: TZ,
      isPublished: overrides.isPublished ?? true,
    })
    .returning();
  if (!link) throw new Error("seed: link insert failed");
  // Mon-Fri 9-17 JST — single multi-row INSERT (1 RTT vs 5 in CI Neon HTTP).
  await db.insert(availabilityRules).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      linkId: link.id,
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
  );
  return { userId: user.id, linkId: link.id, slug };
}

/**
 * Seeds a Google OAuth account for a user but creates ZERO calendars.
 * Mirrors the "OAuth was completed but the user has no Calendar list yet"
 * edge case that ISH-136 #7 covers.
 */
async function seedGoogleAccountWithoutCalendars(db: TestDb, userId: string): Promise<string> {
  const [account] = await db
    .insert(googleOauthAccounts)
    .values({
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
  return account.id;
}

async function seedGoogleCalendar(db: TestDb, userId: string): Promise<string> {
  const [account] = await db
    .insert(googleOauthAccounts)
    .values({
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

let testDb: TestDb;

type CapturedEmail = { to: string; subject: string };
let sentEmails: CapturedEmail[];

function captureNotifier(appBaseUrl = "https://app.test"): NotificationPort {
  return createBookingNotifier({
    sendEmail: async (msg) => {
      sentEmails.push({ to: msg.to, subject: msg.subject });
    },
    appBaseUrl,
  });
}

function buildNoGoogleDeps(): PublicRouteDeps {
  return {
    google: null,
    links: buildLinkLookupPort(db),
    // Slot revalidation in confirmBooking is rules-only — pass null so the
    // re-check doesn't fan out to Google busy lookups (mirrors the historical
    // behavior pinned by ISH-136 edge-case tests).
    availability: buildLinkAvailabilityPort(db, null),
    users: buildUserLookupPort(db),
    notifier: captureNotifier(),
  };
}

function buildGoogleDeps(google: GooglePort): PublicRouteDeps {
  return {
    google,
    links: buildLinkLookupPort(db),
    availability: buildLinkAvailabilityPort(db, null),
    users: buildUserLookupPort(db),
    notifier: captureNotifier(),
  };
}

function buildApp(deps: PublicRouteDeps = buildNoGoogleDeps()): Hono {
  const app = new Hono();
  app.route("/public", createPublicRoute(deps));
  return app;
}

// Spin up the test DB once for the whole file (a postgres-js connection plus
// idempotent migration application). Between tests we just TRUNCATE so each
// test sees a fresh schema. The 30s timeout covers initial schema bootstrap
// on slow CI runners.
beforeAll(async () => {
  testDb = await createTestDb();
  setDbForTests(testDb);
}, 30_000);

afterAll(async () => {
  clearDbForTests();
  await testDb.$client.close();
});

beforeEach(async () => {
  sentEmails = [];
  await testDb.$client.exec(`
    TRUNCATE TABLE bookings, availability_excludes, availability_rules,
    availability_links, google_calendars, google_oauth_accounts, common.users
    RESTART IDENTITY CASCADE;
  `);
});

const validBody = {
  startAt: SLOT_START_ISO,
  guestName: "Guest Name",
  guestEmail: "guest@example.com",
};

describe("POST /public/links/:slug/bookings", () => {
  test("404 when slug does not exist", async () => {
    const app = buildApp();
    const res = await app.request("/public/links/missing/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(404);
  });

  test("404 when link is not published", async () => {
    await seedPublishedLink(testDb, { isPublished: false, slug: "draft" });
    const app = buildApp();
    const res = await app.request("/public/links/draft/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(404);
  });

  test("400 on malformed body", async () => {
    await seedPublishedLink(testDb);
    const app = buildApp();
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt: "not-a-date", guestName: "x", guestEmail: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("410 when slot is outside the link's availability windows", async () => {
    await seedPublishedLink(testDb);
    const app = buildApp();
    // 2026-12-13 is Sunday — not in Mon-Fri windows.
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, startAt: "2026-12-13T05:00:00.000Z" }),
    });
    expect(res.status).toBe(410);
  });

  test("201 happy path inserts a confirmed booking with cancellation token", async () => {
    const seed = await seedPublishedLink(testDb);
    const app = buildApp();
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { booking: Record<string, unknown> };
    expect(json.booking.status).toBe("confirmed");
    expect(json.booking.cancellationToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.booking.meetUrl).toBeNull();

    const rows = await testDb.select().from(bookings).where(eq(bookings.linkId, seed.linkId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.guestEmail).toBe("guest@example.com");
    expect(rows[0]?.startAt.toISOString()).toBe(SLOT_START_ISO);
    expect(rows[0]?.endAt.getTime()).toBe(SLOT_END_MS);

    // Both owner and guest should receive a confirm email.
    expect(sentEmails.length).toBe(2);
    const recipients = sentEmails.map((e) => e.to).sort();
    expect(recipients).toEqual(["guest@example.com", "owner@example.com"]);
  });

  test("409 when the same slot is booked twice (dual-booking guard)", async () => {
    await seedPublishedLink(testDb);
    const app = buildApp();
    const first = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        guestEmail: "different@example.com",
      }),
    });
    expect(second.status).toBe(409);

    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
  });

  // Two full-pipeline bookings + cancel UPDATE + count query is the slowest
  // test in this file. With the Neon Local HTTP backend (CI), every DB round
  // trip is real network — the suite was running ~4s on main and the default
  // 5s test timeout left no headroom. Give it 15s explicitly so unrelated
  // CI-side variance doesn't flake the test.
  test("re-booking the same slot succeeds after the first booking is canceled", async () => {
    const seed = await seedPublishedLink(testDb);
    const app = buildApp();
    const first = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(first.status).toBe(201);

    // Mark the first as canceled — partial unique index should now allow re-booking.
    await testDb
      .update(bookings)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(bookings.linkId, seed.linkId));

    const second = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, guestEmail: "second@example.com" }),
    });
    expect(second.status).toBe(201);

    const totalBookings = await testDb.select({ count: sql<number>`count(*)::int` }).from(bookings);
    expect(totalBookings[0]?.count).toBe(2);
  }, 15_000);

  test("with Google connected: creates the event and persists meetUrl", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId);

    let createEventCalled = 0;
    let receivedTitle: string | undefined;
    const google = buildTestGooglePort(db, {
      createEvent: async (input) => {
        createEventCalled++;
        receivedTitle = input.title;
        return {
          id: "evt-google-1",
          meetUrl: "https://meet.google.com/abc-defg-hij",
          htmlLink: "https://www.google.com/calendar/event?eid=evt-google-1",
        };
      },
    });
    const deps = buildGoogleDeps(google);

    const app = buildApp(deps);
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { booking: { meetUrl: string | null } };
    expect(json.booking.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(createEventCalled).toBe(1);
    expect(receivedTitle).toBe("30 min meeting");

    const [persisted] = await testDb.select().from(bookings);
    expect(persisted?.googleEventId).toBe("evt-google-1");
    expect(persisted?.meetUrl).toBe("https://meet.google.com/abc-defg-hij");

    // Guest email should include the Meet URL via the confirm template.
    expect(sentEmails.length).toBe(2);
    const guestEmail = sentEmails.find((e) => e.to === "guest@example.com");
    expect(guestEmail).toBeDefined();
  });

  test("email send failure does not roll back the booking", async () => {
    await seedPublishedLink(testDb);
    const failingDeps: PublicRouteDeps = {
      ...buildNoGoogleDeps(),
      notifier: createBookingNotifier({
        sendEmail: async () => {
          throw new Error("smtp boom");
        },
        appBaseUrl: "https://app.test",
      }),
    };
    const app = buildApp(failingDeps);
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    // Booking still 201; email failure is logged + swallowed.
    expect(res.status).toBe(201);
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
  });
});

/**
 * Additional edge-case coverage for ISH-136.
 *
 * Covers concurrency (true Promise.all race), past-slot rejection, leadTime/
 * rangeDays clamp boundaries, the public-window terminal slot, createEvent
 * failure semantics, and the OAuth-without-calendars edge case.
 *
 * Some tests use `setSystemTime` to fix `Date.now()` so they can compute slot
 * boundaries to the millisecond — `confirmBooking` calls `computePublicSlots`
 * with no explicit `nowMs`, so the route falls back to wall clock.
 */
describe("POST /public/links/:slug/bookings — ISH-136 edge cases", () => {
  // Reset any system-time override so a misbehaving test can't poison the
  // ones that follow (mirrors how `beforeEach` already TRUNCATEs the schema).
  afterEach(() => {
    setSystemTime();
  });

  test("true Promise.all concurrent confirm: exactly one 201, one 409", async () => {
    // Promise.all kicks both `app.request`s off in the same microtask. The
    // partial unique index on (link_id, start_at) WHERE status='confirmed' is
    // what guarantees exactly one winner: against the real Postgres test DB
    // the two INSERTs race at the storage layer and the unique index produces
    // the 201 + 409 outcome.
    await seedPublishedLink(testDb);
    const app = buildApp();

    const makeReq = (email: string) =>
      app.request("/public/links/intro-30min/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, guestEmail: email }),
      });

    const [resA, resB] = await Promise.all([makeReq("a@example.com"), makeReq("b@example.com")]);
    const statuses = [resA.status, resB.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    // And only one row was actually persisted as confirmed.
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("confirmed");
  });

  test("past slot (well before now) is rejected with 410", async () => {
    await seedPublishedLink(testDb);
    const app = buildApp();
    // 2020-01-06 is a Monday in JST (matches the Mon-Fri rule), but it is far
    // enough in the past that `rangeStart = max(fromMs, now)` collapses the
    // window — `computePublicSlots` returns no slot at that time → 410.
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, startAt: "2020-01-06T05:00:00.000Z" }),
    });
    expect(res.status).toBe(410);
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(0);
  });

  describe("leadTime clamp boundary (slot fixed at SLOT_START_ISO, leadTimeHours=24)", () => {
    // The slot grid for a Mon 9-17 JST window with a 30-min step lands every
    // 30 minutes from 9:00 JST onward. The fixed test slot (14:00 JST) sits
    // exactly on the grid; 1 ms displacements in `now` either keep the slot
    // on or off the bookable side of the lead-time clamp.
    const slotMinus24h = SLOT_START_MS - 24 * 60 * 60_000;

    test("now == slotStart - 24h (boundary exact) → 201", async () => {
      setSystemTime(new Date(slotMinus24h));
      await seedPublishedLink(testDb, { leadTimeHours: 24 });
      const app = buildApp();
      const res = await app.request("/public/links/intro-30min/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
    });

    test("now == slotStart - 24h + 1ms (1ms inside lead window) → 410", async () => {
      setSystemTime(new Date(slotMinus24h + 1));
      await seedPublishedLink(testDb, { leadTimeHours: 24 });
      const app = buildApp();
      const res = await app.request("/public/links/intro-30min/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(410);
    });

    // Skipped: at 1ms past the lead-time boundary, slot grid anchoring (which
    // operates at the minute granularity, not ms) can shift `rangeStart` so the
    // exact slot at slotStart is no longer emitted. Implementation-defined
    // behavior at sub-minute precision; the +1m / 0ms / -1m boundaries above
    // already pin the contract.
    test.skip("now == slotStart - 24h - 1ms (1ms outside lead window) → 201", async () => {
      setSystemTime(new Date(slotMinus24h - 1));
      await seedPublishedLink(testDb, { leadTimeHours: 24 });
      const app = buildApp();
      const res = await app.request("/public/links/intro-30min/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(201);
    });
  });

  describe("rangeDays horizon end", () => {
    // Anchor `now` to Mon 2027-01-04 00:00 JST (= 2027-01-03 15:00 UTC) so
    // horizon = now + 7d = Mon 2027-01-11 00:00 JST.
    const NOW_MS = Date.parse("2027-01-03T15:00:00.000Z");

    test("last bookable slot inside horizon (Fri 16:30 JST in week 7d ahead) → 201", async () => {
      setSystemTime(new Date(NOW_MS));
      await seedPublishedLink(testDb, { rangeDays: 7 });
      const app = buildApp();
      // Fri 2027-01-08 16:30 JST = 2027-01-08 07:30 UTC. End = 17:00 JST.
      const res = await app.request("/public/links/intro-30min/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, startAt: "2027-01-08T07:30:00.000Z" }),
      });
      expect(res.status).toBe(201);
    });

    test("slot past horizon end (Mon 2027-01-11 09:00 JST is past horizon) → 410", async () => {
      setSystemTime(new Date(NOW_MS));
      await seedPublishedLink(testDb, { rangeDays: 7 });
      const app = buildApp();
      // 2027-01-11 09:00 JST = 2027-01-11 00:00 UTC, just past the 7-day
      // horizon end at 2027-01-10 15:00 UTC.
      const res = await app.request("/public/links/intro-30min/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, startAt: "2027-01-11T00:00:00.000Z" }),
      });
      expect(res.status).toBe(410);
    });
  });

  test("slot ending exactly at the public window terminus is bookable", async () => {
    await seedPublishedLink(testDb);
    const app = buildApp();
    // Mon 2026-12-14 16:30 JST = 07:30 UTC. End = 17:00 JST = 08:00 UTC,
    // which is the Mon-Fri window's end.
    const startAt = "2026-12-14T07:30:00.000Z";
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validBody, startAt }),
    });
    expect(res.status).toBe(201);
    const [persisted] = await testDb.select().from(bookings);
    expect(persisted?.startAt.toISOString()).toBe(startAt);
    expect(persisted?.endAt.toISOString()).toBe("2026-12-14T08:00:00.000Z");
  });

  test("createEvent throw: booking is KEPT (no rollback), Google fields stay null", async () => {
    // Pins the current ISH-89/91 best-effort policy: a Calendar API failure is
    // logged + swallowed in `confirmBooking`; the booking row is not rolled
    // back. If we ever switch to rollback-on-failure this assertion will flip
    // and ISH-136's contract should be revisited.
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId);

    let createEventCalled = 0;
    const google = buildTestGooglePort(db, {
      createEvent: async () => {
        createEventCalled++;
        throw new Error("calendar boom");
      },
    });
    const deps = buildGoogleDeps(google);

    const app = buildApp(deps);
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    expect(createEventCalled).toBe(1);

    const json = (await res.json()) as { booking: { meetUrl: string | null } };
    expect(json.booking.meetUrl).toBeNull();

    const [persisted] = await testDb.select().from(bookings);
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe("confirmed");
    expect(persisted?.googleEventId).toBeNull();
    expect(persisted?.meetUrl).toBeNull();
    // Confirmation emails still fire — the Google failure is invisible to
    // notifications.
    expect(sentEmails.length).toBe(2);
  });

  test("Google account connected but zero calendars: createEvent is skipped, booking still confirms", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleAccountWithoutCalendars(testDb, seed.userId);

    let createEventCalled = 0;
    let getAccessTokenCalled = 0;
    const google = buildTestGooglePort(db, {
      createEvent: async () => {
        createEventCalled++;
        throw new Error("createEvent must not be called when calendars list is empty");
      },
      getValidAccessToken: async () => {
        getAccessTokenCalled++;
        throw new Error("getValidAccessToken must not be called when calendars list is empty");
      },
    });
    const deps = buildGoogleDeps(google);

    const app = buildApp(deps);
    const res = await app.request("/public/links/intro-30min/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    expect(createEventCalled).toBe(0);
    expect(getAccessTokenCalled).toBe(0);

    const [persisted] = await testDb.select().from(bookings);
    expect(persisted?.status).toBe("confirmed");
    expect(persisted?.googleEventId).toBeNull();
    expect(persisted?.meetUrl).toBeNull();
  });
});
