import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { clearDbForTests, setDbForTests } from "@/db/client";
import {
  availabilityLinks,
  availabilityRules,
  bookings,
  googleCalendars,
  googleOauthAccounts,
  users,
} from "@/db/schema";
import { createPublicRoute, type PublicRouteDeps } from "@/routes/public";
import { createTestDb, type TestDb } from "@/test/integration-db";

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
  overrides: { slug?: string; isPublished?: boolean } = {},
): Promise<Seeded> {
  const [user] = await db
    .insert(users)
    .values({ clerkId: `clerk_${randomUUID()}`, email: "owner@example.com" })
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
      rangeDays: 3650,
      timeZone: TZ,
      isPublished: overrides.isPublished ?? true,
    })
    .returning();
  if (!link) throw new Error("seed: link insert failed");
  // Mon-Fri 9-17 JST
  for (const weekday of [1, 2, 3, 4, 5]) {
    await db
      .insert(availabilityRules)
      .values({ linkId: link.id, weekday, startMinute: 9 * 60, endMinute: 17 * 60 });
  }
  return { userId: user.id, linkId: link.id, slug };
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

const noGoogleDeps: PublicRouteDeps = {
  loadCfg: () => null,
  createEvent: async () => {
    throw new Error("createEvent should not be called in no-Google tests");
  },
  getAccessToken: async () => {
    throw new Error("getAccessToken should not be called in no-Google tests");
  },
  sendEmail: async (msg) => {
    sentEmails.push({ to: msg.to, subject: msg.subject });
  },
  appBaseUrl: "https://app.test",
};

function buildApp(deps: PublicRouteDeps = noGoogleDeps): Hono {
  const app = new Hono();
  app.route("/public", createPublicRoute(deps));
  return app;
}

// PGlite WASM init is the slow part — do it once for the whole file. Between
// tests we just TRUNCATE so each test sees a fresh schema. The 30s timeout
// covers cold WASM init on slow CI runners (Bun's default 5s isn't enough).
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
    availability_links, google_calendars, google_oauth_accounts, users
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
  });

  test("with Google connected: creates the event and persists meetUrl", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId);

    let createEventCalled = 0;
    let receivedTitle: string | undefined;
    const deps: PublicRouteDeps = {
      loadCfg: () => ({
        clientId: "x",
        clientSecret: "y",
        redirectUri: "z",
        encryptionKey: Buffer.alloc(32),
        appBaseUrl: "http://app",
      }),
      createEvent: async (input) => {
        createEventCalled++;
        receivedTitle = input.title;
        return {
          id: "evt-google-1",
          meetUrl: "https://meet.google.com/abc-defg-hij",
          htmlLink: "https://www.google.com/calendar/event?eid=evt-google-1",
        };
      },
      getAccessToken: async () => "fake-access-token",
      sendEmail: async (msg) => {
        sentEmails.push({ to: msg.to, subject: msg.subject });
      },
      appBaseUrl: "https://app.test",
    };

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
      ...noGoogleDeps,
      sendEmail: async () => {
        throw new Error("smtp boom");
      },
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
