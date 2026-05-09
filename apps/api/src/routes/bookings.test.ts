import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { availabilityLinks, bookings, tenants, users } from "@/db/schema";
import type { AuthVars } from "@/middleware/auth";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import type { GooglePort, NotificationPort } from "@/ports";
import { type BookingsRouteDeps, createBookingsRoute } from "@/routes/bookings";
import { buildTestGooglePort } from "@/test/booking-ports";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { ensureUserByClerkId } from "@/users/usecase";
import { buildLinkAvailabilityPort, buildLinkLookupPort, buildUserLookupPort } from "@/wiring";

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
    // ISH-270: reschedule re-check uses the rules grid only (no busy merge).
    availability: buildLinkAvailabilityPort(db, null),
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
      // Avoid hitting the real Clerk API: synthesize a profile from the header.
      getUserByExternalId: async (id) => ({
        externalId: id,
        email: `${id}@example.com`,
        firstName: null,
        lastName: null,
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
type SeededLink = { linkId: string; slug: string; userId: string; tenantId: string };

async function seedTenant(): Promise<string> {
  const [tenant] = await testDb.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed tenant failed");
  return tenant.id;
}

async function seedUser(label: string): Promise<SeededUser> {
  const externalId = `clerk_${label}_${randomUUID()}`;
  const [row] = await testDb
    .insert(users)
    .values({ externalId, email: `${label}@example.com`, name: label })
    .returning();
  if (!row) throw new Error("seed user failed");
  return { userId: row.id, externalId };
}

async function seedLink(
  tenantId: string,
  userId: string,
  slug: string,
  title = "30 min meet",
): Promise<SeededLink> {
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      tenantId,
      userId,
      slug,
      title,
      durationMinutes: 30,
      timeZone: TZ,
    })
    .returning();
  if (!link) throw new Error("seed link failed");
  return { linkId: link.id, slug: link.slug, userId, tenantId };
}

async function seedConfirmedBooking(
  tenantId: string,
  linkId: string,
  overrides: {
    startAt?: Date;
    guestEmail?: string;
    googleEventId?: string | null;
    hostUserId?: string;
  } = {},
): Promise<string> {
  const startAt = overrides.startAt ?? new Date("2026-12-14T05:00:00.000Z");
  const endAt = new Date(startAt.getTime() + 30 * 60_000);
  // ISH-267: host_user_id is NOT NULL. Tests typically pass the seeded link's
  // owner userId; if omitted, look it up via the link row to avoid every
  // call site needing to thread it through.
  let hostUserId = overrides.hostUserId;
  if (!hostUserId) {
    const [linkRow] = await testDb
      .select({ userId: availabilityLinks.userId })
      .from(availabilityLinks)
      .where(eq(availabilityLinks.id, linkId))
      .limit(1);
    if (!linkRow) throw new Error("seed booking: link not found");
    hostUserId = linkRow.userId;
  }
  const [row] = await testDb
    .insert(bookings)
    .values({
      tenantId,
      linkId,
      hostUserId,
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
    TRUNCATE TABLE tenant.bookings, tenant.availability_rules,
    tenant.availability_links, tenant.google_calendars, tenant.google_oauth_accounts,
    common.tenants, common.users
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
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link");
    await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-14T05:00:00.000Z"),
    });
    await seedConfirmedBooking(tenantId, link.linkId, {
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
      total: number;
      page: number;
      pageSize: number;
    };
    expect(json.bookings.length).toBe(2);
    expect(json.total).toBe(2);
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(25);
    // sorted by startAt desc per route
    expect(json.bookings[0]?.guestEmail).toBe("second@example.com");
    expect(json.bookings[1]?.guestEmail).toBe("guest@example.com");
    for (const b of json.bookings) {
      expect(b.linkSlug).toBe("owner-link");
    }
  });

  test("tenant isolation: bookings under another user's link are not returned", async () => {
    const tenantId = await seedTenant();
    const me = await seedUser("me");
    const other = await seedUser("other");
    const myLink = await seedLink(tenantId, me.userId, "my-link");
    const otherLink = await seedLink(tenantId, other.userId, "other-link");
    await seedConfirmedBooking(tenantId, myLink.linkId, { guestEmail: "mine@example.com" });
    await seedConfirmedBooking(tenantId, otherLink.linkId, { guestEmail: "theirs@example.com" });

    const app = buildApp();
    const res = await app.request("/bookings", {
      headers: { "x-test-clerk-id": me.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bookings: Array<{ guestEmail: string; linkSlug: string }>;
      total: number;
    };
    expect(json.bookings.length).toBe(1);
    expect(json.total).toBe(1);
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
    const json = (await res.json()) as { bookings: unknown[]; total: number };
    expect(json.bookings).toEqual([]);
    expect(json.total).toBe(0);
  });

  // ---------- ISH-268: server-side search / status / pagination ----------

  test("?q= filters by guestName / guestEmail / linkTitle (case-insensitive)", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link", "Sales Demo");
    await seedConfirmedBooking(tenantId, link.linkId, {
      guestEmail: "alice@example.com",
      startAt: new Date("2026-12-14T05:00:00.000Z"),
    });
    await seedConfirmedBooking(tenantId, link.linkId, {
      guestEmail: "bob@acme.com",
      startAt: new Date("2026-12-15T05:00:00.000Z"),
    });

    const app = buildApp();
    const res = await app.request("/bookings?q=acme", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      bookings: Array<{ guestEmail: string }>;
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.bookings[0]?.guestEmail).toBe("bob@acme.com");
  });

  test("?status=canceled narrows to canceled rows; ?status=all returns everything", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link");
    const confirmedId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-14T05:00:00.000Z"),
    });
    const canceledId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-15T05:00:00.000Z"),
      guestEmail: "canc@example.com",
    });
    await testDb
      .update(bookings)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(bookings.id, canceledId));

    const app = buildApp();

    const cancelOnly = await app.request("/bookings?status=canceled", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    const cancelJson = (await cancelOnly.json()) as {
      bookings: Array<{ id: string; status: string }>;
      total: number;
    };
    expect(cancelJson.total).toBe(1);
    expect(cancelJson.bookings[0]?.id).toBe(canceledId);
    expect(cancelJson.bookings[0]?.status).toBe("canceled");

    const allRes = await app.request("/bookings?status=all", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    const allJson = (await allRes.json()) as { total: number; bookings: Array<{ id: string }> };
    expect(allJson.total).toBe(2);
    const ids = allJson.bookings.map((b) => b.id).sort();
    expect(ids).toEqual([confirmedId, canceledId].sort());
  });

  test("?page= / ?pageSize= slice the result and total reflects the unsliced match", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link");
    // 5 bookings spaced 1 hour apart starting from a stable far-future moment.
    const base = new Date("2026-12-14T05:00:00.000Z").getTime();
    for (let i = 0; i < 5; i++) {
      await seedConfirmedBooking(tenantId, link.linkId, {
        startAt: new Date(base + i * 60 * 60 * 1000),
        guestEmail: `g${i}@example.com`,
      });
    }

    const app = buildApp();

    const page1 = await app.request("/bookings?page=1&pageSize=2", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    const j1 = (await page1.json()) as {
      bookings: Array<{ guestEmail: string }>;
      total: number;
      page: number;
      pageSize: number;
    };
    expect(j1.total).toBe(5);
    expect(j1.page).toBe(1);
    expect(j1.pageSize).toBe(2);
    expect(j1.bookings.length).toBe(2);
    // Ordered by startAt desc: latest two first.
    expect(j1.bookings[0]?.guestEmail).toBe("g4@example.com");
    expect(j1.bookings[1]?.guestEmail).toBe("g3@example.com");

    const page3 = await app.request("/bookings?page=3&pageSize=2", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    const j3 = (await page3.json()) as {
      bookings: Array<{ guestEmail: string }>;
      total: number;
      page: number;
    };
    expect(j3.total).toBe(5);
    expect(j3.page).toBe(3);
    expect(j3.bookings.length).toBe(1);
    expect(j3.bookings[0]?.guestEmail).toBe("g0@example.com");
  });

  test("400 on invalid query (status not in enum, pageSize > 100, page < 1)", async () => {
    const owner = await seedUser("owner");
    const app = buildApp();

    const badStatus = await app.request("/bookings?status=banana", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(badStatus.status).toBe(400);

    const tooLarge = await app.request("/bookings?pageSize=999", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(tooLarge.status).toBe(400);

    const zeroPage = await app.request("/bookings?page=0", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(zeroPage.status).toBe(400);
  });
});

describe("GET /bookings/export.csv — ISH-271", () => {
  test("401 when no auth header is present", async () => {
    const app = buildApp();
    const res = await app.request("/bookings/export.csv");
    expect(res.status).toBe(401);
  });

  test("200 returns CSV body with BOM, headers, and Content-Disposition attachment", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link", "Sales Demo");
    await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-14T05:00:00.000Z"),
      guestEmail: "alice@example.com",
    });
    await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-15T05:00:00.000Z"),
      guestEmail: "bob@example.com",
    });

    const app = buildApp();
    const res = await app.request("/bookings/export.csv", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const dispo = res.headers.get("Content-Disposition") ?? "";
    expect(dispo).toContain("attachment");
    expect(dispo).toMatch(/filename="bookings-\d{8}\.csv"/);

    const body = await res.text();
    // Leading BOM (U+FEFF) for Excel compat.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).split("\r\n");
    // header + 2 rows
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("開始日時");
    expect(lines[0]).toContain("ステータス");
    // Latest first (sorted by startAt desc)
    expect(lines[1]).toContain("bob@example.com");
    expect(lines[2]).toContain("alice@example.com");
  });

  test("respects ?status=canceled and ?q= filters (mirrors GET /bookings)", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link", "Sales Demo");
    const confirmedId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-14T05:00:00.000Z"),
      guestEmail: "stay@example.com",
    });
    const canceledId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-15T05:00:00.000Z"),
      guestEmail: "canc@example.com",
    });
    await testDb
      .update(bookings)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(bookings.id, canceledId));

    const app = buildApp();

    // status=canceled — only the canceled row.
    const cancelOnly = await app.request("/bookings/export.csv?status=canceled", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(cancelOnly.status).toBe(200);
    const cancelBody = (await cancelOnly.text()).slice(1);
    const cancelLines = cancelBody.split("\r\n");
    expect(cancelLines.length).toBe(2); // header + 1 row
    expect(cancelLines[1]).toContain("canc@example.com");
    expect(cancelLines[1]).toContain("キャンセル済");
    expect(cancelBody).not.toContain("stay@example.com");
    // Suppress unused-var lint on confirmedId (still asserts the seed worked).
    expect(confirmedId).toBeTruthy();

    // q=stay — partial match against guestEmail.
    const qRes = await app.request("/bookings/export.csv?q=stay", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(qRes.status).toBe(200);
    const qBody = (await qRes.text()).slice(1);
    const qLines = qBody.split("\r\n");
    expect(qLines.length).toBe(2);
    expect(qLines[1]).toContain("stay@example.com");
  });

  test("returns header-only CSV when the user has no bookings", async () => {
    const owner = await seedUser("owner");
    const app = buildApp();
    const res = await app.request("/bookings/export.csv", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    // BOM + header row only — no record separator.
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.slice(1).split("\r\n").length).toBe(1);
    expect(body).toContain("開始日時");
  });

  test("tenant isolation: another owner's bookings are excluded", async () => {
    const tenantId = await seedTenant();
    const me = await seedUser("me");
    const other = await seedUser("other");
    const myLink = await seedLink(tenantId, me.userId, "my-link");
    const otherLink = await seedLink(tenantId, other.userId, "other-link");
    await seedConfirmedBooking(tenantId, myLink.linkId, { guestEmail: "mine@example.com" });
    await seedConfirmedBooking(tenantId, otherLink.linkId, { guestEmail: "theirs@example.com" });

    const app = buildApp();
    const res = await app.request("/bookings/export.csv", {
      headers: { "x-test-clerk-id": me.externalId },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("mine@example.com");
    expect(body).not.toContain("theirs@example.com");
  });

  test("400 on invalid status value", async () => {
    const owner = await seedUser("owner");
    const app = buildApp();
    const res = await app.request("/bookings/export.csv?status=banana", {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /bookings/:id (owner detail) — ISH-254", () => {
  test("401 when no auth header is present", async () => {
    const app = buildApp();
    const res = await app.request("/bookings/some-id");
    expect(res.status).toBe(401);
  });

  test("200 returns the authed user's own booking with link metadata", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link", "30 min meet");
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date("2026-12-14T05:00:00.000Z"),
    });

    const app = buildApp();
    const res = await app.request(`/bookings/${bookingId}`, {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      booking: {
        id: string;
        linkId: string;
        linkSlug: string;
        linkTitle: string;
        guestEmail: string;
        status: string;
      };
    };
    expect(json.booking.id).toBe(bookingId);
    expect(json.booking.linkId).toBe(link.linkId);
    expect(json.booking.linkSlug).toBe("owner-link");
    expect(json.booking.linkTitle).toBe("30 min meet");
    expect(json.booking.guestEmail).toBe("guest@example.com");
    expect(json.booking.status).toBe("confirmed");
  });

  test("404 when the booking id does not exist", async () => {
    const owner = await seedUser("owner");
    const app = buildApp();
    const res = await app.request(`/bookings/${randomUUID()}`, {
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("not_found");
  });

  test("authorization: cannot read another user's booking — responds 404 (no info leak)", async () => {
    // Mirrors the DELETE /bookings/:id cross-owner test below: foreign owner
    // bookings are collapsed to 404 to avoid leaking the existence of valid
    // booking ids that belong to other users (cf. ISH-183 cross-tenant test).
    const tenantId = await seedTenant();
    const me = await seedUser("me");
    const other = await seedUser("other");
    const otherLink = await seedLink(tenantId, other.userId, "other-link");
    const otherBookingId = await seedConfirmedBooking(tenantId, otherLink.linkId, {
      guestEmail: "victim@example.com",
    });

    const app = buildApp();
    const res = await app.request(`/bookings/${otherBookingId}`, {
      headers: { "x-test-clerk-id": me.externalId },
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("not_found");
  });
});

describe("DELETE /bookings/:id (owner cancel)", () => {
  test("401 when no auth header is present", async () => {
    const app = buildApp();
    const res = await app.request("/bookings/some-id", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  test("200 cancels the authed user's own booking and fires both emails", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link");
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId);

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
    const tenantId = await seedTenant();
    const me = await seedUser("me");
    const other = await seedUser("other");
    const otherLink = await seedLink(tenantId, other.userId, "other-link");
    const otherBookingId = await seedConfirmedBooking(tenantId, otherLink.linkId, {
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
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    await seedLink(tenantId, owner.userId, "owner-link");

    const app = buildApp();
    const res = await app.request(`/bookings/${randomUUID()}`, {
      method: "DELETE",
      headers: { "x-test-clerk-id": owner.externalId },
    });
    expect(res.status).toBe(404);
  });

  test("idempotent: cancelling the same booking twice returns alreadyCanceled and skips emails", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link");
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId);

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
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLink(tenantId, owner.userId, "owner-link");
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId, { googleEventId: "evt-1" });

    // Insert a fake OAuth account + calendar so `cancelBookingByOwner` reaches
    // the deleteEvent code path (it short-circuits without calendars).
    const { googleOauthAccounts, googleCalendars } = await import("@/db/schema");
    const [acct] = await testDb
      .insert(googleOauthAccounts)
      .values({
        tenantId,
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
      tenantId,
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

describe("POST /bookings/:id/reschedule (ISH-270)", () => {
  // Far-future Monday so the slot is always in the future regardless of when
  // the suite runs. Both ORIGINAL and NEW fall inside Mon-Fri 9-17 JST.
  const ORIGINAL_START_ISO = "2026-12-14T05:00:00.000Z"; // Mon 14:00 JST
  const NEW_START_ISO = "2026-12-14T06:00:00.000Z"; // Mon 15:00 JST
  const NEW_END_ISO = "2026-12-14T06:30:00.000Z";

  async function seedRules(tenantId: string, linkId: string): Promise<void> {
    const { availabilityRules } = await import("@/db/schema");
    await testDb.insert(availabilityRules).values(
      [1, 2, 3, 4, 5].map((weekday) => ({
        tenantId,
        linkId,
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      })),
    );
  }

  // Bump rangeDays so the far-future test slot stays inside the link's
  // booking horizon — `seedLink` uses the schema default of 60 days, which
  // is far closer than our fixed 2026-12-14 anchor.
  async function seedLinkWithFarHorizon(
    tenantId: string,
    userId: string,
    slug: string,
  ): Promise<SeededLink> {
    const link = await seedLink(tenantId, userId, slug);
    await testDb
      .update(availabilityLinks)
      .set({ rangeDays: 3650 })
      .where(eq(availabilityLinks.id, link.linkId));
    return link;
  }

  test("401 when no auth header is present", async () => {
    const app = buildApp();
    const res = await app.request("/bookings/some-id/reschedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt: NEW_START_ISO, endAt: NEW_END_ISO }),
    });
    expect(res.status).toBe(401);
  });

  test("200 reschedules the authed user's own booking and returns updated booking", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLinkWithFarHorizon(tenantId, owner.userId, "owner-link");
    await seedRules(tenantId, link.linkId);
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date(ORIGINAL_START_ISO),
    });

    const app = buildApp();
    const res = await app.request(`/bookings/${bookingId}/reschedule`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-clerk-id": owner.externalId,
      },
      body: JSON.stringify({ startAt: NEW_START_ISO, endAt: NEW_END_ISO }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { booking: { startAt: string; endAt: string } };
    expect(json.booking.startAt).toBe(NEW_START_ISO);
    expect(json.booking.endAt).toBe(NEW_END_ISO);

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.startAt.toISOString()).toBe(NEW_START_ISO);
    expect(row?.endAt.toISOString()).toBe(NEW_END_ISO);
    expect(sentEmails.length).toBe(2);
    for (const e of sentEmails) expect(e.subject).toContain("予約変更");
  });

  test("404 when booking belongs to another user (no info-leak)", async () => {
    const tenantId = await seedTenant();
    const me = await seedUser("me");
    const other = await seedUser("other");
    const otherLink = await seedLinkWithFarHorizon(tenantId, other.userId, "other-link");
    await seedRules(tenantId, otherLink.linkId);
    const bookingId = await seedConfirmedBooking(tenantId, otherLink.linkId, {
      startAt: new Date(ORIGINAL_START_ISO),
    });

    const app = buildApp();
    const res = await app.request(`/bookings/${bookingId}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-clerk-id": me.externalId },
      body: JSON.stringify({ startAt: NEW_START_ISO, endAt: NEW_END_ISO }),
    });
    expect(res.status).toBe(404);
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.startAt.toISOString()).toBe(ORIGINAL_START_ISO);
    expect(sentEmails.length).toBe(0);
  });

  test("422 availability_violation when new slot falls outside the link rules", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLinkWithFarHorizon(tenantId, owner.userId, "owner-link");
    await seedRules(tenantId, link.linkId);
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date(ORIGINAL_START_ISO),
    });

    const app = buildApp();
    const res = await app.request(`/bookings/${bookingId}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-clerk-id": owner.externalId },
      body: JSON.stringify({
        // Sunday 2026-12-13 — outside the Mon-Fri windows.
        startAt: "2026-12-13T05:00:00.000Z",
        endAt: "2026-12-13T05:30:00.000Z",
      }),
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("availability_violation");
  });

  test("422 not_reschedulable when booking is already canceled", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser("owner");
    const link = await seedLinkWithFarHorizon(tenantId, owner.userId, "owner-link");
    await seedRules(tenantId, link.linkId);
    const bookingId = await seedConfirmedBooking(tenantId, link.linkId, {
      startAt: new Date(ORIGINAL_START_ISO),
    });
    await testDb
      .update(bookings)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(eq(bookings.id, bookingId));

    const app = buildApp();
    const res = await app.request(`/bookings/${bookingId}/reschedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-clerk-id": owner.externalId },
      body: JSON.stringify({ startAt: NEW_START_ISO, endAt: NEW_END_ISO }),
    });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("not_reschedulable");
  });

  test("400 when body is missing or malformed", async () => {
    const owner = await seedUser("owner");
    const app = buildApp();
    // missing endAt
    const res = await app.request("/bookings/abc/reschedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-clerk-id": owner.externalId },
      body: JSON.stringify({ startAt: NEW_START_ISO }),
    });
    expect(res.status).toBe(400);
  });
});
