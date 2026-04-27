import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { availabilityLinks, bookings, users } from "@/db/schema";
import type { AuthVars } from "@/middleware/auth";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import type { GooglePort, NotificationPort } from "@/ports";
import { type BookingsRouteDeps, createBookingsRoute } from "@/routes/bookings";
import { buildTestGooglePort } from "@/test/booking-ports";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { ensureUserByClerkId } from "@/users/usecase";
import { buildLinkLookupPort, buildUserLookupPort } from "@/wiring";

const TZ = "Asia/Tokyo";

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

// Default fake deps mirror `public.bookings.test.ts`: no Google, capture emails.
function buildNoGoogleDeps(): Omit<BookingsRouteDeps, "authMiddlewares"> {
  return {
    google: null,
    links: buildLinkLookupPort(db),
    users: buildUserLookupPort(db),
    notifier: captureNotifier(),
  };
}

/**
 * Builds a fake auth middleware stack that:
 * 1. reads a test header (`x-test-clerk-id`) instead of validating a Clerk JWT,
 * 2. returns 401 when the header is missing (mirroring `requireAuth`),
 * 3. resolves the local DB user via `ensureUserByClerkId` (same path as
 *    production `attachDbUser`), so route handlers see a real `dbUser`.
 */
function fakeAuthMiddlewares(): MiddlewareHandler[] {
  const requireFakeAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
    const clerkId = c.req.header("x-test-clerk-id");
    if (!clerkId) {
      return c.json({ error: "unauthorized" }, 401);
    }
    // Route via the `db` proxy (which `setDbForTests` redirects to `testDb`)
    // so `ensureUserByClerkId` — typed against the production postgres-js
    // drizzle instance — sees the test database.
    const dbUser = await ensureUserByClerkId(db, clerkId, {
      // Avoid hitting the real Clerk API: synthesize a payload from the header.
      fetchUser: async (id) => ({
        id,
        email_addresses: [{ id: "e1", email_address: `${id}@example.com` }],
        primary_email_address_id: "e1",
        first_name: null,
        last_name: null,
      }),
    });
    c.set("dbUser", dbUser);
    await next();
  };
  return [requireFakeAuth];
}

function buildApp(extra: Partial<BookingsRouteDeps> = {}): Hono {
  const deps: BookingsRouteDeps = {
    ...buildNoGoogleDeps(),
    ...extra,
    authMiddlewares: fakeAuthMiddlewares(),
  };
  const app = new Hono();
  app.route("/bookings", createBookingsRoute(deps));
  return app;
}

type SeededUser = { userId: string; externalId: string };
type SeededLink = { linkId: string; slug: string; userId: string };

async function seedUser(label: string): Promise<SeededUser> {
  const externalId = `clerk_${label}_${randomUUID()}`;
  const [row] = await testDb
    .insert(users)
    .values({ externalId, email: `${label}@example.com`, name: label })
    .returning();
  if (!row) throw new Error("seed user failed");
  return { userId: row.id, externalId };
}

async function seedLink(userId: string, slug: string, title = "30 min meet"): Promise<SeededLink> {
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      userId,
      slug,
      title,
      durationMinutes: 30,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link failed");
  return { linkId: link.id, slug: link.slug, userId };
}

async function seedConfirmedBooking(
  linkId: string,
  overrides: { startAt?: Date; guestEmail?: string; googleEventId?: string | null } = {},
): Promise<string> {
  const startAt = overrides.startAt ?? new Date("2026-12-14T05:00:00.000Z");
  const endAt = new Date(startAt.getTime() + 30 * 60_000);
  const [row] = await testDb
    .insert(bookings)
    .values({
      linkId,
      startAt,
      endAt,
      guestName: "Guest",
      guestEmail: overrides.guestEmail ?? "guest@example.com",
      status: "confirmed",
      googleEventId: overrides.googleEventId ?? null,
    })
    .returning();
  if (!row) throw new Error("seed booking failed");
  return row.id;
}

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

describe("GET /bookings (owner list)", () => {
  test("401 when no auth header is present", async () => {
    const app = buildApp();
    const res = await app.request("/bookings");
    expect(res.status).toBe(401);
  });

  test("200 returns only the authed user's bookings", async () => {
    const owner = await seedUser("owner");
    const link = await seedLink(owner.userId, "owner-link");
    await seedConfirmedBooking(link.linkId, {
      startAt: new Date("2026-12-14T05:00:00.000Z"),
    });
    await seedConfirmedBooking(link.linkId, {
      startAt: new Date("2026-12-15T05:00:00.000Z"),
      guestEmail: "second@example.com",
    });

    const app = buildApp();
    const res = await app.request("/bookings", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bookings: Array<{ linkSlug: string; guestEmail: string }>;
    };
    expect(json.bookings.length).toBe(2);
    // sorted by startAt desc per route
    expect(json.bookings[0]?.guestEmail).toBe("second@example.com");
    expect(json.bookings[1]?.guestEmail).toBe("guest@example.com");
    for (const b of json.bookings) {
      expect(b.linkSlug).toBe("owner-link");
    }
  });

  test("tenant isolation: bookings under another user's link are not returned", async () => {
    const me = await seedUser("me");
    const other = await seedUser("other");
    const myLink = await seedLink(me.userId, "my-link");
    const otherLink = await seedLink(other.userId, "other-link");
    await seedConfirmedBooking(myLink.linkId, { guestEmail: "mine@example.com" });
    await seedConfirmedBooking(otherLink.linkId, { guestEmail: "theirs@example.com" });

    const app = buildApp();
    const res = await app.request("/bookings", {
      headers: { "x-test-clerk-id": me.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bookings: Array<{ guestEmail: string; linkSlug: string }>;
    };
    expect(json.bookings.length).toBe(1);
    expect(json.bookings[0]?.guestEmail).toBe("mine@example.com");
    expect(json.bookings[0]?.linkSlug).toBe("my-link");
  });

  test("200 returns empty array when the user owns no links", async () => {
    const me = await seedUser("me");
    const app = buildApp();
    const res = await app.request("/bookings", {
      headers: { "x-test-clerk-id": me.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bookings: unknown[] };
    expect(json.bookings).toEqual([]);
  });
});

describe("DELETE /bookings/:id (owner cancel)", () => {
  test("401 when no auth header is present", async () => {
    const app = buildApp();
    const res = await app.request("/bookings/some-id", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  test("200 cancels the authed user's own booking and fires both emails", async () => {
    const owner = await seedUser("owner");
    const link = await seedLink(owner.userId, "owner-link");
    const bookingId = await seedConfirmedBooking(link.linkId);

    const app = buildApp();
    const res = await app.request(`/bookings/${bookingId}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; alreadyCanceled?: boolean };
    expect(json.ok).toBe(true);
    expect(json.alreadyCanceled).toBeUndefined();

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();

    expect(sentEmails.length).toBe(2);
    expect(sentEmails.map((e) => e.to).sort()).toEqual(["guest@example.com", "owner@example.com"]);
  });

  test("authorization: cannot cancel another user's booking — responds 404 (no info leak)", async () => {
    // Current implementation returns `not_found` (404) when the booking exists
    // but is owned by someone else. This is intentional: revealing 403 would
    // leak the existence of foreign booking IDs. Locking this down so any
    // future refactor that drops the ownership guard fails loudly.
    const me = await seedUser("me");
    const other = await seedUser("other");
    const otherLink = await seedLink(other.userId, "other-link");
    const otherBookingId = await seedConfirmedBooking(otherLink.linkId, {
      guestEmail: "victim@example.com",
    });

    const app = buildApp();
    const res = await app.request(`/bookings/${otherBookingId}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": me.externalId },
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("not_found");

    // Critical: the foreign booking must remain confirmed, untouched.
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, otherBookingId));
    expect(row?.status).toBe("confirmed");
    expect(row?.canceledAt).toBeNull();
    // No emails should have been dispatched.
    expect(sentEmails.length).toBe(0);
  });

  test("404 when the booking id does not exist", async () => {
    const owner = await seedUser("owner");
    await seedLink(owner.userId, "owner-link");

    const app = buildApp();
    const res = await app.request(`/bookings/${randomUUID()}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(404);
  });

  test("idempotent: cancelling the same booking twice returns alreadyCanceled and skips emails", async () => {
    const owner = await seedUser("owner");
    const link = await seedLink(owner.userId, "owner-link");
    const bookingId = await seedConfirmedBooking(link.linkId);

    const app = buildApp();
    const first = await app.request(`/bookings/${bookingId}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(first.status).toBe(200);
    expect(sentEmails.length).toBe(2);

    sentEmails = [];
    const second = await app.request(`/bookings/${bookingId}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(second.status).toBe(200);
    const json = (await second.json()) as { ok: boolean; alreadyCanceled?: boolean };
    expect(json.ok).toBe(true);
    expect(json.alreadyCanceled).toBe(true);
    expect(sentEmails.length).toBe(0);
  });

  test("Google event delete failure does not roll back the cancel (best-effort)", async () => {
    // Seed an owner with a Google OAuth account + write-enabled calendar so
    // the cancel side-effect path actually attempts the delete and we can
    // observe the throw being swallowed.
    const owner = await seedUser("owner");
    const link = await seedLink(owner.userId, "owner-link");
    const bookingId = await seedConfirmedBooking(link.linkId, { googleEventId: "evt-1" });

    // Insert a fake OAuth account + calendar so `cancelBookingByOwner` reaches
    // the deleteEvent code path (it short-circuits without calendars).
    const { googleOauthAccounts, googleCalendars } = await import("@/db/schema");
    const [acct] = await testDb
      .insert(googleOauthAccounts)
      .values({
        userId: owner.userId,
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
    if (!acct) throw new Error("seed oauth failed");
    await testDb.insert(googleCalendars).values({
      oauthAccountId: acct.id,
      googleCalendarId: "primary@example.com",
      summary: "Owner",
      timeZone: TZ,
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: true,
    });

    // Provide a Google port so `cancel.ts` enters the deleteEvent branch.
    // The `getValidAccessToken` fake throws to simulate a transient Google
    // failure; the cancel must still succeed, and the booking must end up
    // canceled.
    const failingGoogle: GooglePort = buildTestGooglePort(db, {
      getValidAccessToken: async () => {
        throw new Error("google boom");
      },
    });
    const failingDeps: Partial<BookingsRouteDeps> = {
      google: failingGoogle,
    };

    const app = buildApp(failingDeps);
    const res = await app.request(`/bookings/${bookingId}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();
  });
});
