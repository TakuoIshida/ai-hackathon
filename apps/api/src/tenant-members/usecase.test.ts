import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { ulid } from "ulidx";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenantMembers, tenants, users } from "@/db/schema/common";
import { invitations } from "@/db/schema/tenant";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { listTenantMembers } from "./usecase";

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

async function seedTenant(name = "Acme") {
  const [t] = await testDb.insert(tenants).values({ name }).returning();
  if (!t) throw new Error("tenant insert failed");
  return t;
}

async function seedUserAndMembership(
  tenantId: string,
  role: "owner" | "member",
  email = `u-${randomUUID()}@x.com`,
) {
  const [u] = await testDb
    .insert(users)
    .values({ externalId: `c_${randomUUID()}`, email, name: email.split("@")[0] ?? "" })
    .returning();
  if (!u) throw new Error("user insert failed");
  await testDb.insert(tenantMembers).values({ userId: u.id, tenantId, role });
  return u;
}

describe("listTenantMembers (ISH-250)", () => {
  test("active members are returned with role + joinedAt", async () => {
    const tenant = await seedTenant();
    await seedUserAndMembership(tenant.id, "owner", "owner@x.com");
    await seedUserAndMembership(tenant.id, "member", "member@x.com");

    const list = await listTenantMembers(db, tenant.id);
    expect(list.length).toBe(2);

    const owner = list.find((m) => m.email === "owner@x.com");
    const member = list.find((m) => m.email === "member@x.com");

    expect(owner).toMatchObject({ role: "owner", status: "active" });
    expect(owner?.userId).toBeTruthy();
    expect(owner?.joinedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(member).toMatchObject({ role: "member", status: "active" });
  });

  test("open invitations are returned as pending until expiresAt", async () => {
    const tenant = await seedTenant();
    const inviter = await seedUserAndMembership(tenant.id, "owner");

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h
    await testDb.insert(invitations).values({
      id: ulid(),
      tenantId: tenant.id,
      email: "pending@x.com",
      invitedByUserId: inviter.id,
      expiresAt: future,
    });

    const list = await listTenantMembers(db, tenant.id);
    const pending = list.find((m) => m.email === "pending@x.com");
    expect(pending).toBeDefined();
    expect(pending?.status).toBe("pending");
    expect(pending?.userId).toBeNull();
    expect(pending?.id).toMatch(/^inv:/);
    expect(pending?.expiresIn).toMatch(/残り/);
    expect(pending?.role).toBe("member");
  });

  test("pending invitation issued with role=owner is surfaced as role=owner (ISH-272)", async () => {
    const tenant = await seedTenant();
    const inviter = await seedUserAndMembership(tenant.id, "owner");

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h
    await testDb.insert(invitations).values({
      id: ulid(),
      tenantId: tenant.id,
      email: "pending-owner@x.com",
      role: "owner",
      invitedByUserId: inviter.id,
      expiresAt: future,
    });

    const list = await listTenantMembers(db, tenant.id);
    const pending = list.find((m) => m.email === "pending-owner@x.com");
    expect(pending).toBeDefined();
    expect(pending?.status).toBe("pending");
    expect(pending?.role).toBe("owner");
  });

  test("invitations past expiresAt are returned as expired without expiresIn", async () => {
    const tenant = await seedTenant();
    const inviter = await seedUserAndMembership(tenant.id, "owner");

    const past = new Date(Date.now() - 60 * 1000); // -1min
    await testDb.insert(invitations).values({
      id: ulid(),
      tenantId: tenant.id,
      email: "expired@x.com",
      invitedByUserId: inviter.id,
      expiresAt: past,
    });

    const list = await listTenantMembers(db, tenant.id);
    const expired = list.find((m) => m.email === "expired@x.com");
    expect(expired?.status).toBe("expired");
    expect(expired?.expiresIn).toBeUndefined();
  });

  test("only the queried tenant's members appear (no cross-tenant leakage)", async () => {
    const a = await seedTenant("A");
    const b = await seedTenant("B");
    await seedUserAndMembership(a.id, "owner", "a-owner@x.com");
    await seedUserAndMembership(b.id, "owner", "b-owner@x.com");

    const listA = await listTenantMembers(db, a.id);
    const emailsA = listA.map((m) => m.email);
    expect(emailsA).toContain("a-owner@x.com");
    expect(emailsA).not.toContain("b-owner@x.com");
  });
});
