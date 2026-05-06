import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { ulid } from "ulidx";
import { clearDbForTests, setDbForTests } from "@/db/client";
import { tenantMembers, tenants, users } from "@/db/schema/common";
import type { AuthVars } from "@/middleware/auth";
import type { IdentityClaims } from "@/ports/identity";
import { tenantMembersRoute } from "@/routes/tenant.members";
import { createTestDb, type TestDb } from "@/test/integration-db";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

describe("/tenant/members auth gate (ISH-250 / ISH-251)", () => {
  test("GET /tenant/members → 401 unauth", async () => {
    const res = await app.request("/tenant/members", { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("DELETE /tenant/members/:userId → 401 unauth", async () => {
    const res = await app.request("/tenant/members/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Integration test for DELETE /tenant/members/:userId (ISH-251)
// ---------------------------------------------------------------------------

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

function fakeIdentitySession(externalId: string, email: string): MiddlewareHandler {
  return async (c, next) => {
    const claims: IdentityClaims = { externalId, email, emailVerified: true };
    c.set("identityClaims", claims as never);
    await next();
  };
}

type SeededUser = { userId: string; externalId: string; email: string; role: "owner" | "member" };

async function seedUser(
  tenantId: string,
  role: "owner" | "member",
  emailLabel: string,
): Promise<SeededUser> {
  const externalId = `clerk_${randomUUID()}`;
  const email = `${emailLabel}-${randomUUID()}@x.com`;
  const [user] = await testDb
    .insert(users)
    .values({ externalId, email, name: emailLabel })
    .returning();
  if (!user) throw new Error("user insert failed");
  await testDb.insert(tenantMembers).values({ userId: user.id, tenantId, role });
  return { userId: user.id, externalId, email, role };
}

async function seedTenant(name = "T") {
  const tenantId = ulid();
  const [tenant] = await testDb.insert(tenants).values({ id: tenantId, name }).returning();
  if (!tenant) throw new Error("tenant insert failed");
  return tenant;
}

function buildAppAs(externalId: string, email: string): Hono<{ Variables: AuthVars }> {
  const a = new Hono<{ Variables: AuthVars }>();
  a.use("*", fakeIdentitySession(externalId, email));
  a.route("/tenant/members", tenantMembersRoute);
  return a;
}

describe("DELETE /tenant/members/:userId (ISH-251)", () => {
  test("owner can remove a member → 200 ok and the row disappears", async () => {
    const tenant = await seedTenant();
    const owner = await seedUser(tenant.id, "owner", "owner");
    const member = await seedUser(tenant.id, "member", "member");
    const a = buildAppAs(owner.externalId, owner.email);

    const res = await a.request(`/tenant/members/${member.userId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await testDb.select().from(tenantMembers);
    expect(rows.find((r) => r.userId === member.userId)).toBeUndefined();
    expect(rows.find((r) => r.userId === owner.userId)).toBeDefined();
  });

  test("non-owner caller → 403 forbidden", async () => {
    const tenant = await seedTenant();
    await seedUser(tenant.id, "owner", "owner");
    const caller = await seedUser(tenant.id, "member", "caller");
    const victim = await seedUser(tenant.id, "member", "victim");
    const a = buildAppAs(caller.externalId, caller.email);

    const res = await a.request(`/tenant/members/${victim.userId}`, { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("forbidden");
  });

  test("owner removing themselves → 400 cannot_remove_self", async () => {
    const tenant = await seedTenant();
    const owner = await seedUser(tenant.id, "owner", "owner");
    const a = buildAppAs(owner.externalId, owner.email);

    const res = await a.request(`/tenant/members/${owner.userId}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("cannot_remove_self");
  });

  test("owner removing another owner → 400 cannot_remove_owner", async () => {
    const tenant = await seedTenant();
    const ownerA = await seedUser(tenant.id, "owner", "owner-a");
    const ownerB = await seedUser(tenant.id, "owner", "owner-b");
    const a = buildAppAs(ownerA.externalId, ownerA.email);

    const res = await a.request(`/tenant/members/${ownerB.userId}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("cannot_remove_owner");

    // Both owner rows untouched.
    const rows = await testDb.select().from(tenantMembers);
    expect(rows.length).toBe(2);
  });

  test("target userId not in this tenant → 404 not_found", async () => {
    const tenant = await seedTenant();
    const owner = await seedUser(tenant.id, "owner", "owner");
    const a = buildAppAs(owner.externalId, owner.email);

    const res = await a.request(`/tenant/members/${ulid()}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
