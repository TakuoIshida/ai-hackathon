import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { createTenantForUser } from "./usecase";

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

async function seedUser(email = `u-${randomUUID()}@x.com`) {
  return insertUser(db, { externalId: `c_${randomUUID()}`, email, name: null });
}

describe("tenants/usecase: createTenantForUser (ISH-175)", () => {
  test("happy path: creates tenant + owner membership and returns ok", async () => {
    const user = await seedUser();
    const result = await createTenantForUser(db, user.id, { name: "Acme Corp" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.tenantName).toBe("Acme Corp");
    expect(result.role).toBe("owner");
    expect(typeof result.tenantId).toBe("string");
    expect(result.tenantId.length).toBeGreaterThan(0);
  });

  test("already_member: returns already_member when user is already in a tenant", async () => {
    const user = await seedUser();
    const first = await createTenantForUser(db, user.id, { name: "First Tenant" });
    expect(first.kind).toBe("ok");

    // Second call with the same user should be blocked by UNIQUE(user_id)
    const second = await createTenantForUser(db, user.id, { name: "Second Tenant" });
    expect(second.kind).toBe("already_member");
  });

  test("two different users can each create their own tenant", async () => {
    const userA = await seedUser();
    const userB = await seedUser();

    const resultA = await createTenantForUser(db, userA.id, { name: "Tenant A" });
    const resultB = await createTenantForUser(db, userB.id, { name: "Tenant B" });

    expect(resultA.kind).toBe("ok");
    expect(resultB.kind).toBe("ok");
    if (resultA.kind !== "ok" || resultB.kind !== "ok") return;
    expect(resultA.tenantId).not.toBe(resultB.tenantId);
  });

  test("tenant name is stored verbatim (trimming handled at schema/route layer)", async () => {
    const user = await seedUser();
    const result = await createTenantForUser(db, user.id, { name: "My Company" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.tenantName).toBe("My Company");
  });
});
