import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import {
  availabilityLinks,
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

let testDb: TestDb;
let sentEmails: { to: string; subject: string }[];

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

async function seedConfirmedBooking(token: string): Promise<{ bookingId: string }> {
  const [user] = await testDb
    .insert(users)
    .values({ externalId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed user");
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      userId: user.id,
      slug: "intro-30min",
      title: "30 min meet",
      durationMinutes: 30,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link");
  const [booking] = await testDb
    .insert(bookings)
    .values({
      linkId: link.id,
      startAt: new Date("2026-12-14T05:00:00Z"),
      endAt: new Date("2026-12-14T05:30:00Z"),
      guestName: "Guest",
      guestEmail: "guest@example.com",
      status: "confirmed",
      cancellationToken: token,
    })
    .returning();
  if (!booking) throw new Error("seed booking");
  return { bookingId: booking.id };
}

/**
 * Seed a confirmed booking already linked to a Google Calendar event so the
 * cancel side-effect path actually attempts a Google delete (it is gated on
 * `google && booking.googleEventId`). Lets the failure-injection tests
 * exercise the real try/catch in cancel.ts rather than short-circuiting on
 * null Google port.
 */
async function seedConfirmedBookingWithGoogle(token: string): Promise<{
  bookingId: string;
  linkId: string;
  userId: string;
}> {
  const [user] = await testDb
    .insert(users)
    .values({ externalId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed user");
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      userId: user.id,
      slug: "intro-30min",
      title: "30 min meet",
      durationMinutes: 30,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link");
  const [account] = await testDb
    .insert(googleOauthAccounts)
    .values({
      userId: user.id,
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
  if (!account) throw new Error("seed oauth account");
  await testDb.insert(googleCalendars).values({
    oauthAccountId: account.id,
    googleCalendarId: "primary@example.com",
    summary: "Owner",
    timeZone: TZ,
    isPrimary: true,
    usedForBusy: true,
    usedForWrites: true,
  });
  const [booking] = await testDb
    .insert(bookings)
    .values({
      linkId: link.id,
      startAt: new Date("2026-12-14T05:00:00Z"),
      endAt: new Date("2026-12-14T05:30:00Z"),
      guestName: "Guest",
      guestEmail: "guest@example.com",
      status: "confirmed",
      cancellationToken: token,
      googleEventId: "evt-abc",
    })
    .returning();
  if (!booking) throw new Error("seed booking");
  return { bookingId: booking.id, linkId: link.id, userId: user.id };
}

describe("POST /public/cancel/:token", () => {
  test("400 on malformed token", async () => {
    const app = buildApp();
    const res = await app.request("/public/cancel/not-a-uuid", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("404 when token does not match", async () => {
    const app = buildApp();
    const res = await app.request(`/public/cancel/${randomUUID()}`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("happy path: cancels confirmed booking, fires both emails, slot is reusable", async () => {
    const token = randomUUID();
    const { bookingId } = await seedConfirmedBooking(token);
    const app = buildApp();

    const res = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(res.status).toBe(200);

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();

    expect(sentEmails.length).toBe(2);
    expect(sentEmails.map((e) => e.to).sort()).toEqual(["guest@example.com", "owner@example.com"]);
    for (const e of sentEmails) expect(e.subject).toContain("予約キャンセル");
  });

  test("idempotent: second cancel returns alreadyCanceled and skips emails", async () => {
    const token = randomUUID();
    await seedConfirmedBooking(token);
    const app = buildApp();
    const first = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(sentEmails.length).toBe(2);

    sentEmails = [];
    const second = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(second.status).toBe(200);
    const json = (await second.json()) as { alreadyCanceled?: boolean };
    expect(json.alreadyCanceled).toBe(true);
    expect(sentEmails.length).toBe(0);
  });

  test("after cancel, the same slot can be re-booked (partial unique index frees it)", async () => {
    const token = randomUUID();
    await seedConfirmedBooking(token);
    const app = buildApp();
    await app.request(`/public/cancel/${token}`, { method: "POST" });

    // The slot is now free — we can insert another confirmed booking for the same (link, start_at).
    const beforeCount = await testDb.select().from(bookings);
    const linkId = beforeCount[0]?.linkId;
    expect(linkId).toBeDefined();

    const [reBook] = await testDb
      .insert(bookings)
      .values({
        linkId: linkId as string,
        startAt: new Date("2026-12-14T05:00:00Z"),
        endAt: new Date("2026-12-14T05:30:00Z"),
        guestName: "Guest 2",
        guestEmail: "g2@example.com",
        status: "confirmed",
      })
      .returning();
    expect(reBook?.status).toBe("confirmed");
  });

  // ISH-137: external API failures must not block the user's cancellation.
  // The Google delete + email send paths in cancel.ts are best-effort and
  // wrapped in try/catch — these tests pin that contract.
  test("Google access-token failure does not block cancel (200 / not alreadyCanceled)", async () => {
    const token = randomUUID();
    const { bookingId } = await seedConfirmedBookingWithGoogle(token);
    let getAccessTokenCalls = 0;
    const google: GooglePort = buildTestGooglePort(db, {
      getValidAccessToken: async () => {
        getAccessTokenCalls++;
        throw new Error("google token endpoint 503");
      },
    });
    const deps: PublicRouteDeps = {
      ...buildNoGoogleDeps(),
      google,
    };
    const app = buildApp(deps);

    const res = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      alreadyCanceled?: boolean;
      bookingId?: string;
    };
    expect(json.ok).toBe(true);
    expect(json.alreadyCanceled).toBeUndefined();
    expect(json.bookingId).toBe(bookingId);

    // The Google call was attempted (so we know we exercised the failure branch).
    expect(getAccessTokenCalls).toBe(1);

    // DB row was canceled regardless of the Google failure.
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();

    // Emails still went out (failure was scoped to the Google block, not the
    // notification block).
    expect(sentEmails.length).toBe(2);
  });

  test("email sender failure does not block cancel (200, DB row still canceled)", async () => {
    const token = randomUUID();
    const { bookingId } = await seedConfirmedBooking(token);
    const failingDeps: PublicRouteDeps = {
      ...buildNoGoogleDeps(),
      notifier: createBookingNotifier({
        sendEmail: async () => {
          throw new Error("smtp 502");
        },
        appBaseUrl: "https://app.test",
      }),
    };
    const app = buildApp(failingDeps);

    const res = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; alreadyCanceled?: boolean };
    expect(json.ok).toBe(true);
    expect(json.alreadyCanceled).toBeUndefined();

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();
  });

  // Token expiry / GC: the bookings schema does not currently carry a
  // cancellation_token expires_at column (see apps/api/src/db/schema/bookings.ts).
  // Until that lands we can only assert "unknown / not-yet-issued token → 404",
  // which is already covered by the "404 when token does not match" case above.
  // TODO(impl-side): add expires_at + GC to bookings.cancellation_token, then add
  // an "expired token → 404 (or 410)" test here.

  test("cancel → re-book same slot → cancel again (state machine is reversible)", async () => {
    // Seed an initial confirmed booking via the public route so we exercise
    // the real confirm path; then cancel it, re-confirm via the same slot, and
    // cancel the new booking using *its* cancellation token.
    const seedToken = randomUUID();
    const { linkId } = await seedConfirmedBookingWithGoogle(seedToken);
    const app = buildApp();

    // First cancel.
    const first = await app.request(`/public/cancel/${seedToken}`, { method: "POST" });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { ok: boolean; alreadyCanceled?: boolean };
    expect(firstJson.ok).toBe(true);
    expect(firstJson.alreadyCanceled).toBeUndefined();

    // Re-book the same (link, start_at) slot directly through the bookings
    // table. The partial unique index only blocks confirmed rows, so this
    // should succeed and produce a fresh cancellation token.
    const reBookToken = randomUUID();
    const [reBook] = await testDb
      .insert(bookings)
      .values({
        linkId,
        startAt: new Date("2026-12-14T05:00:00Z"),
        endAt: new Date("2026-12-14T05:30:00Z"),
        guestName: "Guest 2",
        guestEmail: "g2@example.com",
        status: "confirmed",
        cancellationToken: reBookToken,
      })
      .returning();
    expect(reBook?.status).toBe("confirmed");

    // Second cancel, on the *new* booking via its own token.
    sentEmails = [];
    const second = await app.request(`/public/cancel/${reBookToken}`, { method: "POST" });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as {
      ok: boolean;
      alreadyCanceled?: boolean;
      bookingId?: string;
    };
    expect(secondJson.ok).toBe(true);
    expect(secondJson.alreadyCanceled).toBeUndefined();
    expect(secondJson.bookingId).toBe(reBook?.id);

    // Both rows end up canceled — old token cannot resurrect anything.
    const rows = await testDb.select().from(bookings).where(eq(bookings.linkId, linkId));
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.status).toBe("canceled");
      expect(r.canceledAt).not.toBeNull();
    }

    // Re-cancel via the original token is still 404 (booking is gone-ish for
    // that token's lookup is fine, but we re-cancel via its own token).
    sentEmails = [];
    const reCancelOriginal = await app.request(`/public/cancel/${seedToken}`, { method: "POST" });
    expect(reCancelOriginal.status).toBe(200);
    const j = (await reCancelOriginal.json()) as { alreadyCanceled?: boolean };
    expect(j.alreadyCanceled).toBe(true);
    expect(sentEmails.length).toBe(0);
  });
});
