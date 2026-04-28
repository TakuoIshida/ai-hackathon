import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenantMembers, tenants } from "@/db/schema/common";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import {
  countOwnersForWorkspace,
  createWorkspaceWithOwnerMembership,
  findMembership,
  findWorkspaceById,
  getWorkspaceForMember,
  listMembershipsForUser,
  listMembersWithUserInfo,
  removeMembership,
  updateMembershipRole,
} from "./repo";

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

async function seedUser(email = `u-${randomUUID()}@x.com`) {
  return insertUser(db, { externalId: `c_${randomUUID()}`, email, name: null });
}

describe("workspaces/repo: createWorkspaceWithOwnerMembership (ISH-107)", () => {
  test("inserts the tenant and the owner membership atomically", async () => {
    const owner = await seedUser();
    const result = await createWorkspaceWithOwnerMembership(db, {
      name: "Acme Inc.",
      ownerUserId: owner.id,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.workspace.name).toBe("Acme Inc.");

    const ws = await findWorkspaceById(db, result.workspace.id);
    expect(ws?.id).toBe(result.workspace.id);

    const ms = await findMembership(db, result.workspace.id, owner.id);
    expect(ms?.role).toBe("owner");
  });

  test("two distinct tenants from the same user both succeed (but UNIQUE(user_id) on tenant_members allows only one)", async () => {
    const owner = await seedUser();
    const r1 = await createWorkspaceWithOwnerMembership(db, {
      name: "One",
      ownerUserId: owner.id,
    });
    // Second insert will fail because of UNIQUE(user_id) on tenant_members
    expect(r1.kind).toBe("ok");
    await expect(
      createWorkspaceWithOwnerMembership(db, {
        name: "Two",
        ownerUserId: owner.id,
      }),
    ).rejects.toThrow();
  });
});

describe("workspaces/repo: listMembershipsForUser (ISH-107)", () => {
  test("returns the tenant the user is a member of, with role", async () => {
    const userA = await seedUser();
    const a1 = await createWorkspaceWithOwnerMembership(db, {
      name: "A1",
      ownerUserId: userA.id,
    });
    if (a1.kind !== "ok") throw new Error("seed a1");

    const list = await listMembershipsForUser(db, userA.id);
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("A1");
    expect(list[0]?.role).toBe("owner");
  });

  test("returns [] when user has no memberships", async () => {
    const lonely = await seedUser();
    expect(await listMembershipsForUser(db, lonely.id)).toEqual([]);
  });
});

describe("workspaces/repo: getWorkspaceForMember (ISH-107)", () => {
  test("returns the row when caller is a member", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "Owned",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const got = await getWorkspaceForMember(db, created.workspace.id, owner.id);
    expect(got?.id).toBe(created.workspace.id);
    expect(got?.role).toBe("owner");
  });

  test("returns null when caller is NOT a member", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "Owned",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const got = await getWorkspaceForMember(db, created.workspace.id, stranger.id);
    expect(got).toBeNull();
  });

  test("returns null when workspace id does not exist", async () => {
    const owner = await seedUser();
    expect(await getWorkspaceForMember(db, randomUUID(), owner.id)).toBeNull();
  });
});

describe("workspaces/repo: updateMembershipRole (ISH-111)", () => {
  test("returns true and persists the new role on hit", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "Acme",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const member = await seedUser();
    // Insert member directly bypassing UNIQUE constraint (test only)
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${member.id}', '${created.workspace.id}', 'member')`,
    );

    const updated = await updateMembershipRole(db, created.workspace.id, member.id, "owner");
    expect(updated).toBe(true);
    const reloaded = await findMembership(db, created.workspace.id, member.id);
    expect(reloaded?.role).toBe("owner");
  });

  test("returns false when no membership row matches", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "Acme",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const stranger = await seedUser();

    const updated = await updateMembershipRole(db, created.workspace.id, stranger.id, "owner");
    expect(updated).toBe(false);
  });
});

describe("workspaces/repo: listMembersWithUserInfo (ISH-110)", () => {
  test("returns rows joined with user info, ordered by membership createdAt ASC", async () => {
    const owner = await seedUser("owner@x.com");
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "X",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");

    // Insert two more members with explicit timestamps so we can pin ordering.
    const memberA = await seedUser("a@x.com");
    const memberB = await seedUser("b@x.com");
    const t0 = new Date("2026-04-01T00:00:00.000Z");
    const t1 = new Date("2026-04-02T00:00:00.000Z");
    const t2 = new Date("2026-04-03T00:00:00.000Z");

    // Reset the owner's membership timestamp to t0 so it lands first.
    await testDb
      .update(tenantMembers)
      .set({ createdAt: t0 })
      .where(
        and(eq(tenantMembers.tenantId, created.workspace.id), eq(tenantMembers.userId, owner.id)),
      );
    // Insert additional members bypassing UNIQUE constraint (test only)
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role, created_at)
       VALUES ('${randomUUID()}${randomUUID()}', '${memberB.id}', '${created.workspace.id}', 'member', '${t2.toISOString()}'),
              ('${randomUUID()}${randomUUID()}', '${memberA.id}', '${created.workspace.id}', 'member', '${t1.toISOString()}')`,
    );

    const rows = await listMembersWithUserInfo(db, created.workspace.id);
    expect(rows.map((r) => r.email)).toEqual(["owner@x.com", "a@x.com", "b@x.com"]);
    expect(rows[0]?.role).toBe("owner");
    expect(rows[1]?.role).toBe("member");
    expect(rows[2]?.role).toBe("member");
    expect(rows[0]?.userId).toBe(owner.id);
    // join carries name (null in our seeds)
    expect(rows[0]?.name).toBeNull();
  });

  test("returns [] for a workspace with no memberships (and unknown ids)", async () => {
    expect(await listMembersWithUserInfo(db, randomUUID())).toEqual([]);
  });
});

describe("workspaces/repo: removeMembership (ISH-110)", () => {
  test("returns true when a row was deleted; the row is gone", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "X",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const member = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${member.id}', '${created.workspace.id}', 'member')`,
    );

    const ok = await removeMembership(db, created.workspace.id, member.id);
    expect(ok).toBe(true);
    const rows = await testDb
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, member.id));
    expect(rows.length).toBe(0);
  });

  test("returns false when no membership row matched", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "X",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const ghost = await seedUser();
    const ok = await removeMembership(db, created.workspace.id, ghost.id);
    expect(ok).toBe(false);
  });
});

describe("workspaces/repo: countOwnersForWorkspace (ISH-110/111)", () => {
  test("counts only owner rows scoped to the workspace", async () => {
    const ownerA = await seedUser();
    const wsA = await createWorkspaceWithOwnerMembership(db, {
      name: "A",
      ownerUserId: ownerA.id,
    });
    if (wsA.kind !== "ok") throw new Error("seed");

    expect(await countOwnersForWorkspace(db, wsA.workspace.id)).toBe(1);

    // Add a second owner to wsA bypassing UNIQUE constraint (test only)
    const second = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${second.id}', '${wsA.workspace.id}', 'owner')`,
    );
    expect(await countOwnersForWorkspace(db, wsA.workspace.id)).toBe(2);

    // Members are not counted.
    const memberOnly = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${memberOnly.id}', '${wsA.workspace.id}', 'member')`,
    );
    expect(await countOwnersForWorkspace(db, wsA.workspace.id)).toBe(2);
  });

  test("returns 0 for an unknown workspace id", async () => {
    expect(await countOwnersForWorkspace(db, randomUUID())).toBe(0);
  });
});
