import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");
const { clearDbForTests, db, setDbForTests } = await import("@/db/client");
const { tenantMembers, tenants } = await import("@/db/schema/common");
const { invitations } = await import("@/db/schema/tenant");
const { createInvitationsRoute, createTenantInvitationsRoute } = await import(
  "@/routes/invitations"
);
const { createTestDb } = await import("@/test/integration-db");
const { insertUser } = await import("@/users/repo");

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
type User = Awaited<ReturnType<typeof insertUser>>;

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
    `TRUNCATE TABLE tenant.invitations, common.tenant_members, common.tenants, common.users RESTART IDENTITY CASCADE;`,
  );
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Fake middleware that injects both `identityClaims` and `dbUser` into the
 * Hono context — bypasses real Clerk session and DB lookup.
 */
function fakeAuthWithDbUser(user: User): MiddlewareHandler {
  return async (c, next) => {
    c.set("identityClaims", {
      externalId: user.externalId,
      email: user.email,
      emailVerified: true,
    } as never);
    c.set("dbUser", {
      id: user.id,
      externalId: user.externalId,
      email: user.email,
      name: user.name,
      timeZone: "Asia/Tokyo",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    await next();
  };
}

/**
 * Fake middleware that also sets `tenantId` on the context (replaces
 * `attachTenantContext` for tests). Does NOT open a DB transaction.
 */
function fakeTenantContext(tenantId: string): MiddlewareHandler {
  return async (c, next) => {
    c.set("tenantId", tenantId as never);
    await next();
  };
}

async function seedOwnerAndTenant() {
  const owner = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: `owner-${randomUUID()}@x.com`,
    name: null,
  });
  const [tenant] = await testDb.insert(tenants).values({ name: "Acme Corp" }).returning();
  if (!tenant) throw new Error("seed: tenant insert failed");
  await testDb
    .insert(tenantMembers)
    .values({ userId: owner.id, tenantId: tenant.id, role: "owner" });
  return { owner, tenant };
}

async function seedMember(tenantId: string) {
  const member = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: `member-${randomUUID()}@x.com`,
    name: null,
  });
  await testDb.insert(tenantMembers).values({ userId: member.id, tenantId, role: "member" });
  return member;
}

async function seedInvitation(
  tenantId: string,
  inviterUserId: string,
  opts?: {
    email?: string;
    expiresAt?: Date;
    acceptedAt?: Date | null;
  },
) {
  const [inv] = await testDb
    .insert(invitations)
    .values({
      tenantId,
      email: opts?.email ?? "invitee@example.com",
      invitedByUserId: inviterUserId,
      expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000),
      acceptedAt: opts?.acceptedAt ?? null,
    })
    .returning();
  if (!inv) throw new Error("seed: invitation insert failed");
  return inv;
}

// ---------------------------------------------------------------------------
// Auth gate tests (via the real app singleton)
// ---------------------------------------------------------------------------

describe("POST /tenant/invitations — auth gate", () => {
  test("401 when not authenticated", async () => {
    const res = await app.request("/tenant/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /invitations/:token/accept — auth gate", () => {
  test("401 when not authenticated", async () => {
    const res = await app.request(`/invitations/${randomUUID()}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /tenant/invitations — business logic (injected auth)
// ---------------------------------------------------------------------------

describe("POST /tenant/invitations — validation and business logic", () => {
  test("400 on invalid email", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id)],
      }),
    );

    const res = await testApp.request("/tenant/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  test("403 when caller is a member but not owner", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const member = await seedMember(tenant.id);

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(member), fakeTenantContext(tenant.id)],
      }),
    );

    const res = await testApp.request("/tenant/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invitee@example.com" }),
    });
    expect(res.status).toBe(403);
    // Suppress unused var warning
    void owner;
  });

  test("201 owner successfully creates invitation with token", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id)],
      }),
    );

    const res = await testApp.request("/tenant/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invitee@example.com", role: "member" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitationId: string; token: string; expiresAt: string };
    expect(typeof body.invitationId).toBe("string");
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof body.expiresAt).toBe("string");
  });

  test("409 already_invited when open invitation exists for email", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    await seedInvitation(tenant.id, owner.id, { email: "dup@example.com" });

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id)],
      }),
    );

    const res = await testApp.request("/tenant/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dup@example.com" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_invited");
  });
});

// ---------------------------------------------------------------------------
// POST /invitations/:token/accept — acceptance flow (injected auth)
// ---------------------------------------------------------------------------

describe("POST /invitations/:token/accept — acceptance flow", () => {
  test("201 successful acceptance — creates membership and returns tenantId+role", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inviteeEmail = `invitee-${randomUUID()}@x.com`;
    const inv = await seedInvitation(tenant.id, owner.id, { email: inviteeEmail });
    const invitee = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: inviteeEmail,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/invitations",
      createInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(invitee)],
      }),
    );

    const res = await testApp.request(`/invitations/${inv.token}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tenantId: string; role: string };
    expect(body.tenantId).toBe(tenant.id);
    expect(body.role).toBe("member");
  });

  test("404 for unknown token", async () => {
    const invitee = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: `invitee-${randomUUID()}@x.com`,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/invitations",
      createInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(invitee)],
      }),
    );

    const res = await testApp.request(`/invitations/${randomUUID()}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  test("410 expired invitation", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inviteeEmail = `invitee-${randomUUID()}@x.com`;
    const inv = await seedInvitation(tenant.id, owner.id, {
      email: inviteeEmail,
      expiresAt: new Date(Date.now() - 1000),
    });
    const invitee = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: inviteeEmail,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/invitations",
      createInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(invitee)],
      }),
    );

    const res = await testApp.request(`/invitations/${inv.token}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("expired");
  });

  test("409 already_accepted", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inviteeEmail = `invitee-${randomUUID()}@x.com`;
    const inv = await seedInvitation(tenant.id, owner.id, {
      email: inviteeEmail,
      acceptedAt: new Date(),
    });
    const invitee = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: inviteeEmail,
      name: null,
    });

    const testApp = new Hono();
    testApp.route(
      "/invitations",
      createInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(invitee)],
      }),
    );

    const res = await testApp.request(`/invitations/${inv.token}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_accepted");
  });

  test("409 user_already_in_tenant when caller is already a tenant member", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inviteeEmail = `invitee-${randomUUID()}@x.com`;
    const inv = await seedInvitation(tenant.id, owner.id, { email: inviteeEmail });

    // Create invitee and pre-assign to a different tenant
    const invitee = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: inviteeEmail,
      name: null,
    });
    const [otherTenant] = await testDb.insert(tenants).values({ name: "Other Corp" }).returning();
    if (!otherTenant) throw new Error("seed: other tenant");
    await testDb.insert(tenantMembers).values({
      userId: invitee.id,
      tenantId: otherTenant.id,
      role: "member",
    });

    const testApp = new Hono();
    testApp.route(
      "/invitations",
      createInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(invitee)],
      }),
    );

    const res = await testApp.request(`/invitations/${inv.token}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("user_already_in_tenant");
  });
});
