import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { memberships, workspaces } from "@/db/schema/workspaces";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";

// Schema-level integration tests for ISH-105 (workspaces) + ISH-106 (memberships).
// Verifies the migration applies and the table constraints behave as designed —
// repo / router come with ISH-107.

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
    `TRUNCATE TABLE memberships, workspaces, users RESTART IDENTITY CASCADE;`,
  );
});

async function seedUser() {
  return insertUser(db, {
    clerkId: `c_${randomUUID()}`,
    email: `u-${randomUUID()}@x.com`,
    name: null,
  });
}

async function seedWorkspace(ownerUserId: string, slug = "a", name = "A") {
  const [row] = await testDb.insert(workspaces).values({ name, slug, ownerUserId }).returning();
  if (!row) throw new Error("seed: workspace insert failed");
  return row;
}

describe("workspaces table (ISH-105)", () => {
  test("inserts a row with required fields and returns defaults", async () => {
    const owner = await seedUser();
    const row = await seedWorkspace(owner.id, "acme", "Acme");
    expect(row.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  test("slug is unique", async () => {
    const owner = await seedUser();
    await seedWorkspace(owner.id, "dup");
    await expect(
      testDb.$client.exec(
        `INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('B', 'dup', '${owner.id}')`,
      ),
    ).rejects.toThrow();
  });

  test("owner_user_id is restricted: cannot delete a user that owns a workspace", async () => {
    const owner = await seedUser();
    await seedWorkspace(owner.id);
    await expect(
      testDb.$client.exec(`DELETE FROM users WHERE id = '${owner.id}'`),
    ).rejects.toThrow();
  });
});

describe("memberships table (ISH-106)", () => {
  test("default role is 'member'", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const ws = await seedWorkspace(owner.id);
    const [m] = await testDb
      .insert(memberships)
      .values({ workspaceId: ws.id, userId: member.id })
      .returning();
    expect(m?.role).toBe("member");
  });

  test("(workspace_id, user_id) is unique", async () => {
    const owner = await seedUser();
    const u = await seedUser();
    const ws = await seedWorkspace(owner.id);
    await testDb.insert(memberships).values({ workspaceId: ws.id, userId: u.id, role: "member" });
    await expect(
      testDb.$client.exec(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ('${ws.id}', '${u.id}', 'owner')`,
      ),
    ).rejects.toThrow();
  });

  test("a user can belong to multiple workspaces", async () => {
    const owner = await seedUser();
    const u = await seedUser();
    const wsA = await seedWorkspace(owner.id, "a", "A");
    const wsB = await seedWorkspace(owner.id, "b", "B");
    await testDb.insert(memberships).values([
      { workspaceId: wsA.id, userId: u.id },
      { workspaceId: wsB.id, userId: u.id },
    ]);
    const rows = await testDb.select().from(memberships).where(eq(memberships.userId, u.id));
    expect(rows.length).toBe(2);
  });

  test("deleting a workspace cascades memberships", async () => {
    const owner = await seedUser();
    const u = await seedUser();
    const ws = await seedWorkspace(owner.id);
    await testDb.insert(memberships).values({ workspaceId: ws.id, userId: u.id });
    await testDb.delete(workspaces).where(eq(workspaces.id, ws.id));
    const rows = await testDb.select().from(memberships);
    expect(rows.length).toBe(0);
  });
});
