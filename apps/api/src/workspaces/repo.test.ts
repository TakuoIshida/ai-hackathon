import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { memberships, workspaces } from "@/db/schema/workspaces";
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
    `TRUNCATE TABLE invitations, memberships, workspaces, users RESTART IDENTITY CASCADE;`,
  );
});

async function seedUser(email = `u-${randomUUID()}@x.com`) {
  return insertUser(db, { clerkId: `c_${randomUUID()}`, email, name: null });
}

describe("workspaces/repo: createWorkspaceWithOwnerMembership (ISH-107)", () => {
  test("inserts the workspace and the owner membership atomically", async () => {
    const owner = await seedUser();
    const result = await createWorkspaceWithOwnerMembership(db, {
      name: "Acme Inc.",
      slug: "acme",
      ownerUserId: owner.id,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.workspace.name).toBe("Acme Inc.");
    expect(result.workspace.slug).toBe("acme");
    expect(result.workspace.ownerUserId).toBe(owner.id);

    const ws = await findWorkspaceById(db, result.workspace.id);
    expect(ws?.id).toBe(result.workspace.id);

    const ms = await findMembership(db, result.workspace.id, owner.id);
    expect(ms?.role).toBe("owner");
  });

  test("returns slug_taken when slug already exists; no orphan workspace row remains", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const first = await createWorkspaceWithOwnerMembership(db, {
      name: "First",
      slug: "duplicate",
      ownerUserId: a.id,
    });
    expect(first.kind).toBe("ok");
    const second = await createWorkspaceWithOwnerMembership(db, {
      name: "Second",
      slug: "duplicate",
      ownerUserId: b.id,
    });
    expect(second.kind).toBe("slug_taken");
    // exactly one workspace row exists for the slug
    const rows = await testDb.select().from(workspaces).where(eq(workspaces.slug, "duplicate"));
    expect(rows.length).toBe(1);
    // and its owner is user a, not b — confirms the failed batch did not leak a row
    expect(rows[0]?.ownerUserId).toBe(a.id);
    // user b should have NO membership rows
    const bMemberships = await testDb
      .select()
      .from(memberships)
      .where(eq(memberships.userId, b.id));
    expect(bMemberships.length).toBe(0);
  });

  test("two distinct slugs from the same user both succeed", async () => {
    const owner = await seedUser();
    const r1 = await createWorkspaceWithOwnerMembership(db, {
      name: "One",
      slug: "ws-one",
      ownerUserId: owner.id,
    });
    const r2 = await createWorkspaceWithOwnerMembership(db, {
      name: "Two",
      slug: "ws-two",
      ownerUserId: owner.id,
    });
    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("ok");
  });
});

describe("workspaces/repo: listMembershipsForUser (ISH-107)", () => {
  test("returns only workspaces the user is a member of, with role", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const a1 = await createWorkspaceWithOwnerMembership(db, {
      name: "A1",
      slug: "a-1",
      ownerUserId: userA.id,
    });
    if (a1.kind !== "ok") throw new Error("seed a1");
    const a2 = await createWorkspaceWithOwnerMembership(db, {
      name: "A2",
      slug: "a-2",
      ownerUserId: userA.id,
    });
    if (a2.kind !== "ok") throw new Error("seed a2");
    const b1 = await createWorkspaceWithOwnerMembership(db, {
      name: "B1",
      slug: "b-1",
      ownerUserId: userB.id,
    });
    if (b1.kind !== "ok") throw new Error("seed b1");
    // make userA also a (regular) member of b1
    await testDb
      .insert(memberships)
      .values({ workspaceId: b1.workspace.id, userId: userA.id, role: "member" });

    const list = await listMembershipsForUser(db, userA.id);
    expect(list.length).toBe(3);
    const slugs = list.map((w) => w.slug).sort();
    expect(slugs).toEqual(["a-1", "a-2", "b-1"]);

    const b1Row = list.find((w) => w.slug === "b-1");
    expect(b1Row?.role).toBe("member");
    const a1Row = list.find((w) => w.slug === "a-1");
    expect(a1Row?.role).toBe("owner");
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
      slug: "owned",
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
      slug: "owned-2",
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
      slug: "acme-update",
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const member = await seedUser();
    await testDb
      .insert(memberships)
      .values({ workspaceId: created.workspace.id, userId: member.id, role: "member" });

    const updated = await updateMembershipRole(db, created.workspace.id, member.id, "owner");
    expect(updated).toBe(true);
    const reloaded = await findMembership(db, created.workspace.id, member.id);
    expect(reloaded?.role).toBe("owner");
  });

  test("returns false when no membership row matches", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "Acme",
      slug: "acme-miss",
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
      slug: `ws-${randomUUID()}`,
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
      .update(memberships)
      .set({ createdAt: t0 })
      .where(
        and(eq(memberships.workspaceId, created.workspace.id), eq(memberships.userId, owner.id)),
      );
    await testDb.insert(memberships).values({
      workspaceId: created.workspace.id,
      userId: memberB.id,
      role: "member",
      createdAt: t2,
    });
    await testDb.insert(memberships).values({
      workspaceId: created.workspace.id,
      userId: memberA.id,
      role: "member",
      createdAt: t1,
    });

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
      slug: `ws-${randomUUID()}`,
      ownerUserId: owner.id,
    });
    if (created.kind !== "ok") throw new Error("seed");
    const member = await seedUser();
    await testDb
      .insert(memberships)
      .values({ workspaceId: created.workspace.id, userId: member.id, role: "member" });

    const ok = await removeMembership(db, created.workspace.id, member.id);
    expect(ok).toBe(true);
    const rows = await testDb.select().from(memberships).where(eq(memberships.userId, member.id));
    expect(rows.length).toBe(0);
  });

  test("returns false when no membership row matched", async () => {
    const owner = await seedUser();
    const created = await createWorkspaceWithOwnerMembership(db, {
      name: "X",
      slug: `ws-${randomUUID()}`,
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
    const ownerB = await seedUser();
    const wsA = await createWorkspaceWithOwnerMembership(db, {
      name: "A",
      slug: "ws-count-a",
      ownerUserId: ownerA.id,
    });
    const wsB = await createWorkspaceWithOwnerMembership(db, {
      name: "B",
      slug: "ws-count-b",
      ownerUserId: ownerB.id,
    });
    if (wsA.kind !== "ok" || wsB.kind !== "ok") throw new Error("seed");

    expect(await countOwnersForWorkspace(db, wsA.workspace.id)).toBe(1);
    expect(await countOwnersForWorkspace(db, wsB.workspace.id)).toBe(1);

    // Add a second owner to wsA — wsB count should be unaffected.
    const second = await seedUser();
    await testDb
      .insert(memberships)
      .values({ workspaceId: wsA.workspace.id, userId: second.id, role: "owner" });
    expect(await countOwnersForWorkspace(db, wsA.workspace.id)).toBe(2);
    expect(await countOwnersForWorkspace(db, wsB.workspace.id)).toBe(1);

    // Members are not counted.
    const memberOnly = await seedUser();
    await testDb
      .insert(memberships)
      .values({ workspaceId: wsA.workspace.id, userId: memberOnly.id, role: "member" });
    expect(await countOwnersForWorkspace(db, wsA.workspace.id)).toBe(2);
  });

  test("returns 0 for an unknown workspace id", async () => {
    expect(await countOwnersForWorkspace(db, randomUUID())).toBe(0);
  });
});
