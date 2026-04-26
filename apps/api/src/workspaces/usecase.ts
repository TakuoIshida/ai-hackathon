import type { db as DbClient } from "@/db/client";
import type { MembershipRole } from "@/db/schema/workspaces";
import { workspaceInviteEmail } from "@/notifications/templates";
import type { SendEmailFn } from "@/notifications/types";
import {
  acceptInvitationAtomic,
  type CreateWorkspaceResult,
  countOwnersForWorkspace,
  createInvitation,
  createWorkspaceWithOwnerMembership,
  deleteInvitation,
  findInvitationByToken,
  findMembership,
  findOpenInvitationForEmail,
  findWorkspaceById,
  getWorkspaceForMember,
  type InvitationRow,
  listMembershipsForUser,
  listMembersWithUserInfo,
  removeMembership,
  updateMembershipRole,
  type WorkspaceMemberRow,
  type WorkspaceRow,
  type WorkspaceWithRole,
} from "./repo";
import type { CreateWorkspaceInput } from "./schemas";

type Database = typeof DbClient;

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60_000;

export type IssueInvitationDeps = {
  sendEmail: SendEmailFn;
  appBaseUrl: string;
  // override-able for tests; defaults to Date.now()
  now?: () => number;
};

export type IssueInvitationResult =
  | { kind: "ok"; invitation: InvitationRow }
  | { kind: "workspace_not_found" }
  | { kind: "forbidden" }
  | { kind: "already_invited" };

/**
 * Issue a fresh invitation. Email is sent best-effort; the invitation row
 * is committed even if delivery fails (the operator can re-trigger send,
 * or the invitee will hit "invitation not found" — at which point the
 * workspace owner re-invites). We log + swallow rather than rolling back.
 *
 * Authorization: only an `owner` of the workspace may invite.
 *
 * Conflict policy: only ONE open (unaccepted) invitation per (workspace, email).
 * A second issue attempt while one is open returns `already_invited`. Callers
 * who want to reset can revoke the existing one first.
 */
export async function issueInvitation(
  database: Database,
  inviterUserId: string,
  workspaceId: string,
  email: string,
  deps: IssueInvitationDeps,
): Promise<IssueInvitationResult> {
  const ws = await findWorkspaceById(database, workspaceId);
  if (!ws) return { kind: "workspace_not_found" };

  const membership = await findMembership(database, workspaceId, inviterUserId);
  if (!membership || membership.role !== "owner") return { kind: "forbidden" };

  const existing = await findOpenInvitationForEmail(database, workspaceId, email);
  if (existing) return { kind: "already_invited" };

  const now = deps.now?.() ?? Date.now();
  const expiresAt = new Date(now + INVITE_TTL_MS);
  const invitation = await createInvitation(database, {
    workspaceId,
    email,
    invitedByUserId: inviterUserId,
    expiresAt,
  });

  // Best-effort email delivery.
  try {
    await deps.sendEmail(
      workspaceInviteEmail({
        to: email,
        workspaceName: ws.name,
        acceptUrl: `${deps.appBaseUrl}/invite/${invitation.token}`,
        expiresAt,
      }),
    );
  } catch (err) {
    console.warn("[invite] failed to send invitation email; row kept:", err);
  }

  return { kind: "ok", invitation };
}

// ---------- ISH-107: workspace create / list / get ----------

/**
 * Create a workspace and add the caller as the `owner` membership atomically.
 * Slug uniqueness is enforced by a DB UNIQUE index on workspaces.slug; the
 * repo layer translates the constraint violation into `slug_taken` so the
 * route can map that to a 409. This avoids a TOCTOU window where two
 * concurrent requests both see the slug "available" and try to insert.
 */
export async function createWorkspaceForUser(
  database: Database,
  ownerUserId: string,
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> {
  return createWorkspaceWithOwnerMembership(database, {
    name: input.name,
    slug: input.slug,
    ownerUserId,
  });
}

export async function listWorkspacesForUser(
  database: Database,
  userId: string,
): Promise<WorkspaceWithRole[]> {
  return listMembershipsForUser(database, userId);
}

export type GetWorkspaceResult =
  | { kind: "ok"; workspace: WorkspaceWithRole }
  | { kind: "not_found" };

/**
 * Returns the workspace + caller's role iff the caller is a member. Non-members
 * (and unknown workspace ids) are indistinguishable to avoid leaking existence.
 */
export async function getWorkspaceForUser(
  database: Database,
  userId: string,
  workspaceId: string,
): Promise<GetWorkspaceResult> {
  const row = await getWorkspaceForMember(database, workspaceId, userId);
  if (!row) return { kind: "not_found" };
  return { kind: "ok", workspace: row };
}

export type RevokeInvitationResult = { kind: "ok" } | { kind: "forbidden" } | { kind: "not_found" };

export async function revokeInvitation(
  database: Database,
  inviterUserId: string,
  workspaceId: string,
  email: string,
): Promise<RevokeInvitationResult> {
  const membership = await findMembership(database, workspaceId, inviterUserId);
  if (!membership || membership.role !== "owner") return { kind: "forbidden" };
  const existing = await findOpenInvitationForEmail(database, workspaceId, email);
  if (!existing) return { kind: "not_found" };
  await deleteInvitation(database, existing.id);
  return { kind: "ok" };
}

// ---------- ISH-110: workspace members list / remove ----------

export type WorkspaceMember = {
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "member";
  createdAt: Date;
};

export type ListMembersResult =
  | { kind: "ok"; members: WorkspaceMember[]; callerRole: "owner" | "member" }
  | { kind: "not_found" };

/**
 * List members of a workspace. The caller must be a member of the workspace
 * (any role). Non-members and missing workspace ids are indistinguishable
 * (`not_found`) so we don't leak workspace existence.
 */
export async function listWorkspaceMembers(
  database: Database,
  callerUserId: string,
  workspaceId: string,
): Promise<ListMembersResult> {
  const callerMembership = await findMembership(database, workspaceId, callerUserId);
  if (!callerMembership) return { kind: "not_found" };
  const members = await listMembersWithUserInfo(database, workspaceId);
  return { kind: "ok", members, callerRole: callerMembership.role };
}

export type RemoveMemberResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "last_owner" }
  | { kind: "cannot_remove_self_owner" };

/**
 * Remove a member from a workspace. Owner-only.
 *
 * - Caller is not a member (or workspace doesn't exist) → `not_found` (no leak).
 * - Caller is a member but not an owner → `forbidden`.
 * - Caller is the owner trying to delete themselves → `cannot_remove_self_owner`.
 *   Owners must demote themselves first (ISH-111) — gating that here keeps the
 *   "leave workspace" flow out of this route.
 * - Removing the only remaining owner is rejected with `last_owner`. The
 *   workspace must always have at least one owner.
 * - Otherwise, delete the row. If the row didn't exist, `not_found`.
 */
export async function removeMember(
  database: Database,
  callerUserId: string,
  workspaceId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> {
  const callerMembership = await findMembership(database, workspaceId, callerUserId);
  if (!callerMembership) return { kind: "not_found" };
  if (callerMembership.role !== "owner") return { kind: "forbidden" };
  if (targetUserId === callerUserId) return { kind: "cannot_remove_self_owner" };

  const targetMembership = await findMembership(database, workspaceId, targetUserId);
  if (!targetMembership) return { kind: "not_found" };

  if (targetMembership.role === "owner") {
    const ownerCount = await countOwnersForWorkspace(database, workspaceId);
    if (ownerCount <= 1) return { kind: "last_owner" };
  }

  const deleted = await removeMembership(database, workspaceId, targetUserId);
  if (!deleted) return { kind: "not_found" };
  return { kind: "ok" };
}

// ---------- ISH-111: role management (owner ↔ member) ----------

export type ChangeMemberRoleResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "last_owner" }
  | { kind: "noop" };

/**
 * Change a member's role within a workspace.
 *
 * Rules:
 * - Caller must be a member of the workspace AND have role=owner. Otherwise
 *   `forbidden` (member caller) or `not_found` (caller not in the workspace —
 *   indistinguishable from "workspace does not exist" to avoid leaking).
 * - Target must already be a member of the workspace; else `not_found`.
 * - If the target's current role equals `newRole`, returns `noop` (idempotent).
 * - Demoting the only remaining owner is blocked with `last_owner`. The
 *   "last owner cannot leave" guarantee from the issue is satisfied here for
 *   self-demotion as well — counting owners is symmetric for self vs. other.
 */
export async function changeMemberRole(
  database: Database,
  callerUserId: string,
  workspaceId: string,
  targetUserId: string,
  newRole: MembershipRole,
): Promise<ChangeMemberRoleResult> {
  const callerMembership = await findMembership(database, workspaceId, callerUserId);
  if (!callerMembership) return { kind: "not_found" };
  if (callerMembership.role !== "owner") return { kind: "forbidden" };

  const targetMembership = await findMembership(database, workspaceId, targetUserId);
  if (!targetMembership) return { kind: "not_found" };

  if (targetMembership.role === newRole) return { kind: "noop" };

  if (targetMembership.role === "owner" && newRole === "member") {
    const owners = await countOwnersForWorkspace(database, workspaceId);
    if (owners <= 1) return { kind: "last_owner" };
  }

  const updated = await updateMembershipRole(database, workspaceId, targetUserId, newRole);
  // Row vanished between the read and the write — treat as not_found.
  if (!updated) return { kind: "not_found" };
  return { kind: "ok" };
}

// ISH-109: invitation acceptance.

export type AcceptInvitationDeps = {
  // override-able for tests; defaults to Date.now()
  now?: () => number;
};

export type AcceptInvitationResult =
  | { kind: "ok"; workspace: WorkspaceRow }
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "already_accepted" }
  | { kind: "email_mismatch" };

/**
 * Accept a workspace invitation. The caller is the authenticated invitee
 * (resolved by Clerk + attachDbUser); we re-check that their email matches
 * the invitation row case-insensitively so a different signed-in user can't
 * redeem someone else's link.
 *
 * Idempotent: if the user is already a member of the workspace (e.g. they
 * were added directly before clicking accept), we still mark the invitation
 * as accepted so it can no longer be re-used, but we don't double-insert
 * the membership (handled at the repo layer via ON CONFLICT DO NOTHING).
 */
export async function acceptInvitation(
  database: Database,
  callerUserId: string,
  callerEmail: string,
  token: string,
  deps?: AcceptInvitationDeps,
): Promise<AcceptInvitationResult> {
  const invitation = await findInvitationByToken(database, token);
  if (!invitation) return { kind: "not_found" };
  if (invitation.acceptedAt !== null) return { kind: "already_accepted" };

  const now = deps?.now?.() ?? Date.now();
  if (invitation.expiresAt.getTime() < now) return { kind: "expired" };

  if (invitation.email.toLowerCase() !== callerEmail.toLowerCase()) {
    return { kind: "email_mismatch" };
  }

  const workspace = await findWorkspaceById(database, invitation.workspaceId);
  if (!workspace) return { kind: "not_found" };

  await acceptInvitationAtomic(database, {
    invitationId: invitation.id,
    userId: callerUserId,
    workspaceId: invitation.workspaceId,
    now: new Date(now),
  });

  return { kind: "ok", workspace };
}
