import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
 * Fake middleware that also sets `tenantId` and `tenantRole` on the context
 * (replaces `attachTenantContext` for tests). Does NOT open a DB transaction.
 *
 * ISH-193: tests must supply `tenantRole` because the real middleware now
 * stashes it for `getTenantRole(c)` callers (e.g. owner check in route).
 */
function fakeTenantContext(
  tenantId: string,
  tenantRole: "owner" | "member" = "owner",
): MiddlewareHandler {
  return async (c, next) => {
    c.set("tenantId", tenantId as never);
    c.set("tenantRole", tenantRole as never);
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
        authMiddlewares: [fakeAuthWithDbUser(member), fakeTenantContext(tenant.id, "member")],
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

  test("ISH-252: 201 persists role='owner' from request body to tenant.invitations.role", async () => {
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
      body: JSON.stringify({ email: "new-owner@example.com", role: "owner" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitationId: string };

    const row = await testDb
      .select({ role: invitations.role })
      .from(invitations)
      .where(eq(invitations.id, body.invitationId))
      .limit(1);
    expect(row[0]?.role).toBe("owner");
  });

  test("ISH-252: 201 defaults role to 'member' when omitted from request body", async () => {
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
      body: JSON.stringify({ email: "default-role@example.com" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { invitationId: string };

    const row = await testDb
      .select({ role: invitations.role })
      .from(invitations)
      .where(eq(invitations.id, body.invitationId))
      .limit(1);
    expect(row[0]?.role).toBe("member");
  });

  test("ISH-252: 400 when role is not in the allowed enum", async () => {
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
      body: JSON.stringify({ email: "bad@example.com", role: "admin" }),
    });
    expect(res.status).toBe(400);
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

// ---------------------------------------------------------------------------
// DELETE /tenant/invitations/:invitationId — revoke open invitation (ISH-256)
// ---------------------------------------------------------------------------

describe("DELETE /tenant/invitations/:invitationId — auth gate (ISH-256)", () => {
  test("401 when not authenticated", async () => {
    const res = await app.request("/tenant/invitations/some-id", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /tenant/invitations/:invitationId (ISH-256)", () => {
  test("403 when caller is a member, not owner", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inv = await seedInvitation(tenant.id, owner.id, { email: "x@example.com" });
    const member = await seedMember(tenant.id);

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(member), fakeTenantContext(tenant.id, "member")],
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${inv.id}`, { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("200 owner revokes an open invitation; row is gone", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inv = await seedInvitation(tenant.id, owner.id, { email: "revoke@example.com" });

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id, "owner")],
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${inv.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const rows = await testDb.select().from(invitations).where(eq(invitations.id, inv.id));
    expect(rows).toHaveLength(0);
  });

  test("404 when the invitation does not belong to the caller's tenant", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id, "owner")],
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${randomUUID()}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("409 already_accepted when invitation has been accepted", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inv = await seedInvitation(tenant.id, owner.id, {
      email: "accepted@example.com",
      acceptedAt: new Date(),
    });

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id, "owner")],
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${inv.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_accepted");

    // Row preserved for audit.
    const rows = await testDb.select().from(invitations).where(eq(invitations.id, inv.id));
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /tenant/invitations/:invitationId/resend (ISH-261)
// ---------------------------------------------------------------------------

describe("POST /tenant/invitations/:invitationId/resend — auth gate (ISH-261)", () => {
  test("401 when not authenticated", async () => {
    const res = await app.request("/tenant/invitations/some-id/resend", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /tenant/invitations/:invitationId/resend (ISH-261)", () => {
  test("403 when caller is a member, not owner", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inv = await seedInvitation(tenant.id, owner.id, { email: "x@example.com" });
    const member = await seedMember(tenant.id);

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(member), fakeTenantContext(tenant.id, "member")],
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${inv.id}/resend`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  test("200 owner triggers resend; expiresAt is extended and email is sent via injected port", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    // Pin the original expiry in the past so we can verify it was overwritten.
    const inv = await seedInvitation(tenant.id, owner.id, {
      email: "resend@example.com",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id, "owner")],
        sendEmail: async (msg) => {
          sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
        },
        appBaseUrl: "https://app.test",
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${inv.id}/resend`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; expiresAt: string };
    expect(body.ok).toBe(true);
    expect(typeof body.expiresAt).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // DB row carries the new expiry.
    const [row] = await testDb
      .select({ expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(eq(invitations.id, inv.id));
    expect(row?.expiresAt.toISOString()).toBe(body.expiresAt);

    // Email was sent through the injected port.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("resend@example.com");
    expect(sent[0]?.text).toContain(inv.token);
    expect(sent[0]?.text).toContain("https://app.test/invite/");
  });

  test("404 when the invitation does not belong to the caller's tenant", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();

    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id, "owner")],
        sendEmail: async () => {},
        appBaseUrl: "https://app.test",
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${randomUUID()}/resend`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("409 already_accepted when invitation has been accepted (row preserved untouched)", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const originalExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const inv = await seedInvitation(tenant.id, owner.id, {
      email: "accepted@example.com",
      acceptedAt: new Date(),
      expiresAt: originalExpiresAt,
    });

    const sent: Array<{ to: string }> = [];
    const testApp = new Hono();
    testApp.route(
      "/tenant/invitations",
      createTenantInvitationsRoute({
        authMiddlewares: [fakeAuthWithDbUser(owner), fakeTenantContext(tenant.id, "owner")],
        sendEmail: async (msg) => {
          sent.push({ to: msg.to });
        },
        appBaseUrl: "https://app.test",
      }),
    );

    const res = await testApp.request(`/tenant/invitations/${inv.id}/resend`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_accepted");

    // No mail dispatched; row's expiresAt unchanged.
    expect(sent).toHaveLength(0);
    const [row] = await testDb
      .select({ expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(eq(invitations.id, inv.id));
    expect(row?.expiresAt.toISOString()).toBe(originalExpiresAt.toISOString());
  });
});

describe("GET /invitations/:token — public preview (ISH-208)", () => {
  test("200 returns workspace name + expired flag, but does NOT echo the invited email (anti-enumeration)", async () => {
    const { owner, tenant } = await seedOwnerAndTenant();
    const inviteeEmail = `secret-${randomUUID()}@x.com`;
    const inv = await seedInvitation(tenant.id, owner.id, { email: inviteeEmail });

    const testApp = new Hono();
    testApp.route("/invitations", createInvitationsRoute({}));

    const res = await testApp.request(`/invitations/${inv.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Allowed fields.
    expect(body.workspace).toEqual({ name: tenant.name });
    expect(body.expired).toBe(false);
    // ISH-208: the response MUST NOT include the invited email. A guessed or
    // stolen token would otherwise let an attacker enumerate invitee emails.
    expect(body).not.toHaveProperty("email");
    // Defensive: also pin that no field happens to leak the email by value.
    expect(JSON.stringify(body)).not.toContain(inviteeEmail);
  });

  test("404 for unknown token (no leakage of any field)", async () => {
    const testApp = new Hono();
    testApp.route("/invitations", createInvitationsRoute({}));
    const res = await testApp.request(`/invitations/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});
