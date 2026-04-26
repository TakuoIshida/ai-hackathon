import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { invitations, memberships, workspaces } from "@/db/schema/workspaces";
import type { EmailMessage, SendEmailFn } from "@/notifications/types";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { findOpenInvitationForEmail } from "./repo";
import { issueInvitation, revokeInvitation } from "./usecase";

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

async function seedWorkspace(opts?: {
  ownerEmail?: string;
  name?: string;
  ownerRole?: "owner" | "member";
}) {
  const owner = await seedUser(opts?.ownerEmail);
  const [ws] = await testDb
    .insert(workspaces)
    .values({ name: opts?.name ?? "Acme", slug: `acme-${randomUUID()}`, ownerUserId: owner.id })
    .returning();
  if (!ws) throw new Error("seed: workspace insert failed");
  await testDb
    .insert(memberships)
    .values({ workspaceId: ws.id, userId: owner.id, role: opts?.ownerRole ?? "owner" });
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
    const { workspace } = await seedWorkspace();
    const memberUser = await seedUser();
    await testDb
      .insert(memberships)
      .values({ workspaceId: workspace.id, userId: memberUser.id, role: "member" });
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
