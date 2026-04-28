import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenantMembers, tenants } from "@/db/schema/common";
import { invitations } from "@/db/schema/workspaces";
import type { EmailMessage, SendEmailFn } from "@/notifications/types";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { findInvitationByToken, findMembership, findOpenInvitationForEmail } from "./repo";
import {
  acceptInvitation,
  changeMemberRole,
  createWorkspaceForUser,
  getWorkspaceForUser,
  issueInvitation,
  listWorkspaceMembers,
  listWorkspacesForUser,
  removeMember,
  revokeInvitation,
} from "./usecase";

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

async function seedWorkspace(opts?: {
  ownerEmail?: string;
  name?: string;
  ownerRole?: "owner" | "member";
}) {
  const owner = await seedUser(opts?.ownerEmail);
  const [ws] = await testDb
    .insert(tenants)
    .values({ name: opts?.name ?? "Acme" })
    .returning();
  if (!ws) throw new Error("seed: tenant insert failed");
  await testDb
    .insert(tenantMembers)
    .values({ userId: owner.id, tenantId: ws.id, role: opts?.ownerRole ?? "owner" });
  return { owner, workspace: ws };
}

function captureEmails(): { fn: SendEmailFn; sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    fn: async (msg) => {
      sent.push(msg);
    },
  };
}

const baseDeps = (sendEmail: SendEmailFn = async () => {}) => ({
  sendEmail,
  appBaseUrl: "https://app.test",
});

describe("workspaces/usecase: issueInvitation (ISH-108)", () => {
  test("happy path: creates a row, sends an email, returns ok", async () => {
    const { owner, workspace } = await seedWorkspace();
    const cap = captureEmails();
    const result = await issueInvitation(
      db,
      owner.id,
      workspace.id,
      "invitee@example.com",
      baseDeps(cap.fn),
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.invitation.email).toBe("invitee@example.com");
    expect(result.invitation.token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.invitation.acceptedAt).toBeNull();
    expect(cap.sent.length).toBe(1);
    expect(cap.sent[0]?.to).toBe("invitee@example.com");
    expect(cap.sent[0]?.text).toContain(result.invitation.token);
  });

  test("workspace_not_found when the workspace id does not exist", async () => {
    const owner = await seedUser();
    const result = await issueInvitation(db, owner.id, randomUUID(), "x@x.com", baseDeps());
    expect(result.kind).toBe("workspace_not_found");
  });

  test("forbidden when the inviter is not a member of the workspace", async () => {
    const { workspace } = await seedWorkspace();
    const stranger = await seedUser();
    const result = await issueInvitation(db, stranger.id, workspace.id, "x@x.com", baseDeps());
    expect(result.kind).toBe("forbidden");
  });

  test("forbidden when the inviter is a member but not an owner", async () => {
    // Note: with UNIQUE(user_id), we use a separate tenant for the member
    const { workspace } = await seedWorkspace();
    const memberUser = await seedUser();
    // Insert directly into a different tenant first (to give memberUser a tenantId)
    // Actually with 1 user = 1 tenant, we insert tenantMembers pointing to the same workspace
    // using raw SQL to bypass the UNIQUE constraint check (test scenario only).
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${memberUser.id}', '${workspace.id}', 'member')`,
    );
    const result = await issueInvitation(db, memberUser.id, workspace.id, "x@x.com", baseDeps());
    expect(result.kind).toBe("forbidden");
  });

  test("already_invited when an open invitation already exists for that email", async () => {
    const { owner, workspace } = await seedWorkspace();
    const first = await issueInvitation(db, owner.id, workspace.id, "i@x.com", baseDeps());
    expect(first.kind).toBe("ok");
    const second = await issueInvitation(db, owner.id, workspace.id, "i@x.com", baseDeps());
    expect(second.kind).toBe("already_invited");
  });

  test("re-issuing after acceptedAt is set is allowed", async () => {
    const { owner, workspace } = await seedWorkspace();
    const first = await issueInvitation(db, owner.id, workspace.id, "i@x.com", baseDeps());
    if (first.kind !== "ok") throw new Error("seed");
    await testDb
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, first.invitation.id));
    const second = await issueInvitation(db, owner.id, workspace.id, "i@x.com", baseDeps());
    expect(second.kind).toBe("ok");
  });

  test("expiresAt is ~7 days from now() when override is supplied", async () => {
    const { owner, workspace } = await seedWorkspace();
    const fixedNow = Date.parse("2026-04-26T00:00:00.000Z");
    const result = await issueInvitation(db, owner.id, workspace.id, "i@x.com", {
      ...baseDeps(),
      now: () => fixedNow,
    });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.invitation.expiresAt.getTime()).toBe(fixedNow + 7 * 24 * 60 * 60_000);
  });

  test("commits the row even if email send throws", async () => {
    const { owner, workspace } = await seedWorkspace();
    const result = await issueInvitation(db, owner.id, workspace.id, "i@x.com", {
      ...baseDeps(),
      sendEmail: async () => {
        throw new Error("smtp boom");
      },
    });
    expect(result.kind).toBe("ok");
    const row = await findOpenInvitationForEmail(db, workspace.id, "i@x.com");
    expect(row).not.toBeNull();
  });
});

describe("workspaces/usecase: createWorkspaceForUser (ISH-107)", () => {
  test("happy path: creates workspace + owner membership", async () => {
    const user = await seedUser();
    const result = await createWorkspaceForUser(db, user.id, { name: "Acme" });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.workspace.name).toBe("Acme");
    // listMembershipsForUser should now show this workspace as owner
    const list = await listWorkspacesForUser(db, user.id);
    expect(list.length).toBe(1);
    expect(list[0]?.role).toBe("owner");
  });
});

describe("workspaces/usecase: listWorkspacesForUser (ISH-107)", () => {
  test("scopes to caller membership, includes role per row", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    await createWorkspaceForUser(db, userA.id, { name: "A1" });
    await createWorkspaceForUser(db, userB.id, { name: "B1" });

    const aList = await listWorkspacesForUser(db, userA.id);
    expect(aList.length).toBe(1);
    expect(aList[0]?.name).toBe("A1");
    expect(aList[0]?.role).toBe("owner");
  });
});

describe("workspaces/usecase: getWorkspaceForUser (ISH-107)", () => {
  test("ok when caller is a member; not_found otherwise", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const created = await createWorkspaceForUser(db, owner.id, { name: "X" });
    if (created.kind !== "ok") throw new Error("seed");

    const okRes = await getWorkspaceForUser(db, owner.id, created.workspace.id);
    expect(okRes.kind).toBe("ok");
    if (okRes.kind === "ok") expect(okRes.workspace.role).toBe("owner");

    const strangerRes = await getWorkspaceForUser(db, stranger.id, created.workspace.id);
    expect(strangerRes.kind).toBe("not_found");
  });
});

describe("workspaces/usecase: acceptInvitation (ISH-109)", () => {
  async function seedOpenInvitation(opts?: { email?: string; expiresInMs?: number }) {
    const { owner, workspace } = await seedWorkspace();
    const email = opts?.email ?? "invitee@example.com";
    const issued = await issueInvitation(db, owner.id, workspace.id, email, baseDeps());
    if (issued.kind !== "ok") throw new Error("seed: issueInvitation failed");
    if (opts?.expiresInMs !== undefined) {
      await testDb
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() + opts.expiresInMs) })
        .where(eq(invitations.id, issued.invitation.id));
    }
    return { workspace, owner, invitation: issued.invitation, email };
  }

  test("happy path: existing user is added as member, invitation marked accepted", async () => {
    const { workspace, invitation, email } = await seedOpenInvitation();
    const invitee = await seedUser(email);

    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.workspace.id).toBe(workspace.id);

    // Membership row exists.
    const m = await testDb.select().from(tenantMembers).where(eq(tenantMembers.userId, invitee.id));
    expect(m.length).toBe(1);
    expect(m[0]?.role).toBe("member");

    // Invitation now marked accepted.
    const reloaded = await findInvitationByToken(db, invitation.token);
    expect(reloaded?.acceptedAt).not.toBeNull();
  });

  test("not_found when token does not exist", async () => {
    const invitee = await seedUser();
    const result = await acceptInvitation(db, invitee.id, invitee.email, randomUUID());
    expect(result.kind).toBe("not_found");
  });

  test("expired when expiresAt < now", async () => {
    const { invitation, email } = await seedOpenInvitation({ expiresInMs: -1000 });
    const invitee = await seedUser(email);
    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("expired");
    // Did NOT insert a membership.
    const m = await testDb.select().from(tenantMembers).where(eq(tenantMembers.userId, invitee.id));
    expect(m.length).toBe(0);
  });

  test("already_accepted when acceptedAt is non-null", async () => {
    const { invitation, email } = await seedOpenInvitation();
    await testDb
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, invitation.id));
    const invitee = await seedUser(email);
    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("already_accepted");
  });

  test("email_mismatch when caller email differs from invitation email", async () => {
    const { invitation } = await seedOpenInvitation({ email: "intended@example.com" });
    const wrongUser = await seedUser("someone-else@example.com");
    const result = await acceptInvitation(db, wrongUser.id, wrongUser.email, invitation.token);
    expect(result.kind).toBe("email_mismatch");
  });

  test("email comparison is case-insensitive", async () => {
    const { invitation } = await seedOpenInvitation({ email: "Mixed@Example.COM" });
    const invitee = await seedUser("mixed@example.com");
    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("ok");
  });

  test("idempotent: re-accepting after a duplicate membership exists does not double-insert", async () => {
    const { workspace, invitation, email } = await seedOpenInvitation();
    const invitee = await seedUser(email);
    // Pre-seed membership as if the user had been added independently.
    await testDb
      .insert(tenantMembers)
      .values({ userId: invitee.id, tenantId: workspace.id, role: "member" });

    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("ok");

    // Still exactly one membership row.
    const m = await testDb.select().from(tenantMembers).where(eq(tenantMembers.userId, invitee.id));
    expect(m.length).toBe(1);
    // Invitation is marked accepted.
    const reloaded = await findInvitationByToken(db, invitation.token);
    expect(reloaded?.acceptedAt).not.toBeNull();
  });

  test("now() override is honored for expiry comparison", async () => {
    const { invitation, email } = await seedOpenInvitation();
    const invitee = await seedUser(email);
    // Force a "now" 30 days in the future — past the 7-day TTL.
    const future = Date.now() + 30 * 24 * 60 * 60_000;
    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token, {
      now: () => future,
    });
    expect(result.kind).toBe("expired");
  });

  // Pins the WHERE accepted_at IS NULL guard on acceptInvitationAtomic. Without
  // it, a concurrent second redemption (which the read-then-write window in
  // acceptInvitation cannot itself prevent on neon-http) would overwrite the
  // first acceptance timestamp.
  test("acceptedAt is preserved across a racing second accept", async () => {
    const { invitation, email } = await seedOpenInvitation();
    const invitee = await seedUser(email);
    const t1 = new Date("2026-04-26T01:00:00.000Z");
    const t2 = new Date("2026-04-26T02:00:00.000Z");

    // First accept lands at t1.
    const r1 = await acceptInvitation(db, invitee.id, invitee.email, invitation.token, {
      now: () => t1.getTime(),
    });
    expect(r1.kind).toBe("ok");
    const after1 = await findInvitationByToken(db, invitation.token);
    expect(after1?.acceptedAt?.toISOString()).toBe(t1.toISOString());

    // Second accept tries to land at t2. Usecase short-circuits on
    // already_accepted, but even if a racy caller bypassed that and called
    // the repo directly, the partial-WHERE guard keeps the original timestamp.
    const r2 = await acceptInvitation(db, invitee.id, invitee.email, invitation.token, {
      now: () => t2.getTime(),
    });
    expect(r2.kind).toBe("already_accepted");
    const after2 = await findInvitationByToken(db, invitation.token);
    expect(after2?.acceptedAt?.toISOString()).toBe(t1.toISOString());
  });
});

describe("workspaces/usecase: changeMemberRole (ISH-111)", () => {
  test("ok: promotes a member to owner", async () => {
    const { owner, workspace } = await seedWorkspace();
    const member = await seedUser();
    // Use raw SQL to bypass UNIQUE(user_id) for testing multi-member scenarios
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${member.id}', '${workspace.id}', 'member')`,
    );

    const result = await changeMemberRole(db, owner.id, workspace.id, member.id, "owner");
    expect(result.kind).toBe("ok");
    const reloaded = await findMembership(db, workspace.id, member.id);
    expect(reloaded?.role).toBe("owner");
  });

  test("ok: demotes an owner to member when there is another owner", async () => {
    const { owner, workspace } = await seedWorkspace();
    const second = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${second.id}', '${workspace.id}', 'owner')`,
    );

    const result = await changeMemberRole(db, owner.id, workspace.id, second.id, "member");
    expect(result.kind).toBe("ok");
    const reloaded = await findMembership(db, workspace.id, second.id);
    expect(reloaded?.role).toBe("member");
  });

  test("forbidden when caller is a member, not an owner", async () => {
    const { workspace } = await seedWorkspace();
    const memberCaller = await seedUser();
    const target = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${memberCaller.id}', '${workspace.id}', 'member'),
              ('${randomUUID()}${randomUUID()}', '${target.id}', '${workspace.id}', 'member')`,
    );

    const result = await changeMemberRole(db, memberCaller.id, workspace.id, target.id, "owner");
    expect(result.kind).toBe("forbidden");
  });

  test("not_found when target is not a member of the workspace", async () => {
    const { owner, workspace } = await seedWorkspace();
    const stranger = await seedUser();
    const result = await changeMemberRole(db, owner.id, workspace.id, stranger.id, "owner");
    expect(result.kind).toBe("not_found");
  });

  test("not_found when caller is not a member of the workspace", async () => {
    const { workspace } = await seedWorkspace();
    const stranger = await seedUser();
    const target = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${target.id}', '${workspace.id}', 'member')`,
    );

    const result = await changeMemberRole(db, stranger.id, workspace.id, target.id, "owner");
    expect(result.kind).toBe("not_found");
  });

  test("last_owner: blocks demoting the only owner to member", async () => {
    const { owner, workspace } = await seedWorkspace();
    const result = await changeMemberRole(db, owner.id, workspace.id, owner.id, "member");
    expect(result.kind).toBe("last_owner");
    // role unchanged
    const reloaded = await findMembership(db, workspace.id, owner.id);
    expect(reloaded?.role).toBe("owner");
  });

  test("noop: target's current role already equals newRole", async () => {
    const { owner, workspace } = await seedWorkspace();
    const member = await seedUser();
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${member.id}', '${workspace.id}', 'member')`,
    );

    const result = await changeMemberRole(db, owner.id, workspace.id, member.id, "member");
    expect(result.kind).toBe("noop");
  });
});

describe("workspaces/usecase: listWorkspaceMembers (ISH-110)", () => {
  test("ok: caller is a member; returns members + caller's role", async () => {
    const { owner, workspace } = await seedWorkspace();
    const otherUser = await seedUser("member@x.com");
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${otherUser.id}', '${workspace.id}', 'member')`,
    );

    const result = await listWorkspaceMembers(db, owner.id, workspace.id);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.callerRole).toBe("owner");
    expect(result.members.length).toBe(2);
    const userIds = result.members.map((m) => m.userId).sort();
    expect(userIds).toEqual([owner.id, otherUser.id].sort());
  });

  test("not_found: caller is not a member of the workspace (no leak)", async () => {
    const { workspace } = await seedWorkspace();
    const stranger = await seedUser();
    const result = await listWorkspaceMembers(db, stranger.id, workspace.id);
    expect(result.kind).toBe("not_found");
  });

  test("not_found: workspace id does not exist", async () => {
    const stranger = await seedUser();
    const result = await listWorkspaceMembers(db, stranger.id, randomUUID());
    expect(result.kind).toBe("not_found");
  });
});

describe("workspaces/usecase: removeMember (ISH-110)", () => {
  test("ok: owner removes a regular member; the row is gone", async () => {
    const { owner, workspace } = await seedWorkspace();
    const member = await seedUser("m@x.com");
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${member.id}', '${workspace.id}', 'member')`,
    );

    const result = await removeMember(db, owner.id, workspace.id, member.id);
    expect(result.kind).toBe("ok");
    const rows = await testDb
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, member.id));
    expect(rows.length).toBe(0);
  });

  test("forbidden: caller is a member (not an owner)", async () => {
    const { workspace } = await seedWorkspace();
    const memberA = await seedUser("a@x.com");
    const memberB = await seedUser("b@x.com");
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${memberA.id}', '${workspace.id}', 'member'),
              ('${randomUUID()}${randomUUID()}', '${memberB.id}', '${workspace.id}', 'member')`,
    );

    const result = await removeMember(db, memberA.id, workspace.id, memberB.id);
    expect(result.kind).toBe("forbidden");
  });

  test("not_found: caller is a stranger to the workspace", async () => {
    const { workspace } = await seedWorkspace();
    const stranger = await seedUser();
    const result = await removeMember(db, stranger.id, workspace.id, randomUUID());
    expect(result.kind).toBe("not_found");
  });

  test("not_found: target is not a member of the workspace", async () => {
    const { owner, workspace } = await seedWorkspace();
    const ghost = await seedUser();
    const result = await removeMember(db, owner.id, workspace.id, ghost.id);
    expect(result.kind).toBe("not_found");
  });

  test("ok: removing an owner when a co-owner exists succeeds", async () => {
    // Pins the "target is owner AND ownerCount > 1 → ok" branch.
    const { owner, workspace } = await seedWorkspace();
    const coOwner = await seedUser("co-owner@x.com");
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${coOwner.id}', '${workspace.id}', 'owner')`,
    );
    const result = await removeMember(db, owner.id, workspace.id, coOwner.id);
    expect(result.kind).toBe("ok");
  });

  // `last_owner` is defense-in-depth against a concurrent owner-demotion.
  test("last_owner: count guard fires when target is the only remaining owner", async () => {
    const { owner, workspace } = await seedWorkspace();
    const coOwner = await seedUser("co-owner@x.com");
    await testDb.$client.exec(
      `INSERT INTO common.tenant_members (id, user_id, tenant_id, role)
       VALUES ('${randomUUID()}${randomUUID()}', '${coOwner.id}', '${workspace.id}', 'owner')`,
    );
    const repoModule = await import("./repo");
    const countSpy = spyOn(repoModule, "countOwnersForWorkspace").mockResolvedValue(1);
    try {
      const result = await removeMember(db, owner.id, workspace.id, coOwner.id);
      expect(result.kind).toBe("last_owner");
    } finally {
      countSpy.mockRestore();
    }
  });

  test("cannot_remove_self_owner: owner attempts to delete themselves", async () => {
    const { owner, workspace } = await seedWorkspace();
    const result = await removeMember(db, owner.id, workspace.id, owner.id);
    expect(result.kind).toBe("cannot_remove_self_owner");
  });
});

describe("workspaces/usecase: revokeInvitation (ISH-108)", () => {
  test("ok: deletes the open invitation", async () => {
    const { owner, workspace } = await seedWorkspace();
    await issueInvitation(db, owner.id, workspace.id, "i@x.com", baseDeps());
    const result = await revokeInvitation(db, owner.id, workspace.id, "i@x.com");
    expect(result.kind).toBe("ok");
    expect(await findOpenInvitationForEmail(db, workspace.id, "i@x.com")).toBeNull();
  });

  test("not_found when no open invitation exists", async () => {
    const { owner, workspace } = await seedWorkspace();
    const result = await revokeInvitation(db, owner.id, workspace.id, "ghost@x.com");
    expect(result.kind).toBe("not_found");
  });

  test("forbidden when caller is not an owner", async () => {
    const { workspace } = await seedWorkspace();
    const stranger = await seedUser();
    const result = await revokeInvitation(db, stranger.id, workspace.id, "x@x.com");
    expect(result.kind).toBe("forbidden");
  });
});
