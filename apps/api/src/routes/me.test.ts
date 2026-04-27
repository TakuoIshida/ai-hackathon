import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");
const { clearDbForTests, setDbForTests } = await import("@/db/client");
const { users } = await import("@/db/schema");
const { createMeRoute } = await import("@/routes/me");
const { createTestDb } = await import("@/test/integration-db");
type TestDb = Awaited<ReturnType<typeof createTestDb>>;

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
    availability_links, google_calendars, google_oauth_accounts, common.users
    RESTART IDENTITY CASCADE;
  `);
});

/**
 * Inject `clerkAuth` directly so we exercise the real `requireAuth` middleware
 * without standing up a real Clerk session.
 */
function fakeClerkSession(userId: string | null): MiddlewareHandler {
  return async (c, next) => {
    c.set("clerkAuth", (userId ? { userId } : { userId: null }) as never);
    await next();
  };
}

describe("/me auth gate (router integration)", () => {
  test("GET /me without Authorization → 401", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  test("GET /me with bogus Bearer → 401", async () => {
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /me signed-in success path", () => {
  test("returns the synced dbUser for the current Clerk session", async () => {
    const externalId = `clerk_${randomUUID()}`;
    const [seeded] = await testDb
      .insert(users)
      .values({
        externalId,
        email: "owner@example.com",
        name: "Owner Name",
        timeZone: "Asia/Tokyo",
      })
      .returning();
    if (!seeded) throw new Error("seed failed");

    const meApp = new Hono();
    meApp.route("/me", createMeRoute({ authMiddlewares: [fakeClerkSession(externalId)] }));

    const res = await meApp.request("/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: seeded.id,
      externalId,
      email: "owner@example.com",
      name: "Owner Name",
      timeZone: "Asia/Tokyo",
    });
  });

  test("returns 404 when the Clerk user has no synced row yet", async () => {
    const externalId = `clerk_unsynced_${randomUUID()}`;
    // Note: NOT seeded in DB.
    const meApp = new Hono();
    meApp.route("/me", createMeRoute({ authMiddlewares: [fakeClerkSession(externalId)] }));

    const res = await meApp.request("/me");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "user not synced yet" });
  });

  test("returns 401 when fake session has no userId (requireAuth gate)", async () => {
    const meApp = new Hono();
    meApp.route("/me", createMeRoute({ authMiddlewares: [fakeClerkSession(null)] }));

    const res = await meApp.request("/me");
    expect(res.status).toBe(401);
  });
});
