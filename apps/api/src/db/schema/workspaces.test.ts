import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenantMembers, tenants } from "@/db/schema/common";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";

// Schema-level integration tests for common.tenants (ISH-168 D-1).
// Verifies that the migration applies and table constraints behave as designed.
// Note: workspaces / memberships have been replaced by common.tenants / common.tenant_members.

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

async function seedUser() {
  return insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: `u-${randomUUID()}@x.com`,
    name: null,
  });
}

async function seedTenant(name = "Acme") {
  const [row] = await testDb.insert(tenants).values({ name }).returning();
  if (!row) throw new Error("seed: tenant insert failed");
  return row;
}

describe("common.tenants table (ISH-168)", () => {
  test("inserts a row with required fields and returns defaults", async () => {
    const row = await seedTenant("Acme Corp");
    expect(row.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(row.name).toBe("Acme Corp");
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });
});

describe("common.tenant_members table (ISH-168)", () => {
  test("default role is 'member'", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant();
    const [m] = await testDb
      .insert(tenantMembers)
      .values({ userId: owner.id, tenantId: tenant.id })
      .returning();
    expect(m?.role).toBe("member");
  });

  test("UNIQUE(user_id) enforces 1 user = 1 tenant", async () => {
    const user = await seedUser();
    const tenant1 = await seedTenant("Tenant 1");
    const tenant2 = await seedTenant("Tenant 2");
    await testDb.insert(tenantMembers).values({ userId: user.id, tenantId: tenant1.id });
    await expect(
      testDb.insert(tenantMembers).values({ userId: user.id, tenantId: tenant2.id }).execute(),
    ).rejects.toThrow();
  });

  test("role CHECK constraint rejects invalid roles", async () => {
    const user = await seedUser();
    const tenant = await seedTenant();
    await expect(
      testDb.$client.exec(
        `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
         VALUES ('${randomUUID()}${randomUUID()}', '${user.id}', '${tenant.id}', 'admin')`,
      ),
    ).rejects.toThrow();
  });

  test("deleting a tenant cascades tenant_members", async () => {
    const user = await seedUser();
    const tenant = await seedTenant();
    await testDb.insert(tenantMembers).values({ userId: user.id, tenantId: tenant.id });
    await testDb.delete(tenants).where(eq(tenants.id, tenant.id));
    const rows = await testDb.select().from(tenantMembers);
    expect(rows.length).toBe(0);
  });
});
