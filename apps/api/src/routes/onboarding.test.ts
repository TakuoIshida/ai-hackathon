import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");
const { clearDbForTests, db, setDbForTests } = await import("@/db/client");
const { tenantMembers, tenants } = await import("@/db/schema/common");
const { createOnboardingRoute } = await import("@/routes/onboarding");
const { createTestDb } = await import("@/test/integration-db");
const { insertUser } = await import("@/users/repo");

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
  await testDb.$client.exec(
    `TRUNCATE TABLE common.tenant_members, common.tenants, common.users RESTART IDENTITY CASCADE;`,
  );
});

/**
 * Inject both `identityClaims` AND `dbUser` into the context so we can
 * exercise the onboarding route without a real Clerk session.
 */
function fakeAuthWithDbUser(dbUserId: string, externalId: string): MiddlewareHandler {
  return async (c, next) => {
    c.set("identityClaims", {
      externalId,
      email: `${externalId}@test.com`,
      emailVerified: true,
    } as never);
    c.set("dbUser", {
      id: dbUserId,
      externalId,
      email: `${externalId}@test.com`,
      name: null,
      timeZone: "Asia/Tokyo",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await next();
  };
}

describe("POST /onboarding/tenant — auth gate", () => {
  test("401 when not authenticated (via app)", async () => {
    const res = await app.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Org" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /onboarding/tenant — validation", () => {
  test("400 when body is missing name field", async () => {
    const user = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `u-${randomUUID()}@x.com`,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/onboarding",
      createOnboardingRoute({
        authMiddlewares: [fakeAuthWithDbUser(user.id, user.externalId)],
      }),
    );

    const res = await testApp.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("400 when name is empty string (after trim)", async () => {
    const user = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `u-${randomUUID()}@x.com`,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/onboarding",
      createOnboardingRoute({
        authMiddlewares: [fakeAuthWithDbUser(user.id, user.externalId)],
      }),
    );

    const res = await testApp.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
  });

  test("400 when name exceeds 120 characters", async () => {
    const user = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `u-${randomUUID()}@x.com`,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/onboarding",
      createOnboardingRoute({
        authMiddlewares: [fakeAuthWithDbUser(user.id, user.externalId)],
      }),
    );

    const res = await testApp.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(121) }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /onboarding/tenant — business logic", () => {
  test("201 with tenantId, name, role=owner on successful creation", async () => {
    const user = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `u-${randomUUID()}@x.com`,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/onboarding",
      createOnboardingRoute({
        authMiddlewares: [fakeAuthWithDbUser(user.id, user.externalId)],
      }),
    );

    const res = await testApp.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Company" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tenantId: string; name: string; role: string };
    expect(body.name).toBe("My Company");
    expect(body.role).toBe("owner");
    expect(typeof body.tenantId).toBe("string");
    expect(body.tenantId.length).toBeGreaterThan(0);
  });

  test("name is trimmed before storage", async () => {
    const user = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `u-${randomUUID()}@x.com`,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/onboarding",
      createOnboardingRoute({
        authMiddlewares: [fakeAuthWithDbUser(user.id, user.externalId)],
      }),
    );

    const res = await testApp.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  Trimmed Name  " }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Trimmed Name");
  });

  test("409 with already_member when user creates a second tenant", async () => {
    const user = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `u-${randomUUID()}@x.com`,
      name: null,
    });

    // Pre-seed an existing tenant membership
    const [existingTenant] = await testDb.insert(tenants).values({ name: "Existing" }).returning();
    if (!existingTenant) throw new Error("seed: tenant");
    await testDb
      .insert(tenantMembers)
      .values({ userId: user.id, tenantId: existingTenant.id, role: "owner" });

    const testApp = new Hono();
    testApp.route(
      "/onboarding",
      createOnboardingRoute({
        authMiddlewares: [fakeAuthWithDbUser(user.id, user.externalId)],
      }),
    );

    const res = await testApp.request("/onboarding/tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Another Tenant" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_member");
  });
});
