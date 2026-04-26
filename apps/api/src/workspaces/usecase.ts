import type { db as DbClient } from "@/db/client";
import { workspaceInviteEmail } from "@/notifications/templates";
import type { SendEmailFn } from "@/notifications/types";
import {
  createInvitation,
  deleteInvitation,
  findMembership,
  findOpenInvitationForEmail,
  findWorkspaceById,
  type InvitationRow,
} from "./repo";

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
