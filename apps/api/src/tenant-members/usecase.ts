import type { db as DbClient } from "@/db/client";
import type { TenantMemberRole } from "@/db/schema/common";
import {
  countOwnersForTenant,
  findActiveMembersForTenant,
  findOpenInvitationsForTenant,
  findTenantMember,
  updateTenantMemberRole,
} from "./repo";

type Database = typeof DbClient;

/**
 * Status reflects the row's source.
 *
 * - `active`: row exists in common.tenant_members
 * - `pending`: open invitation, not yet expired
 * - `expired`: open invitation past expiresAt
 *
 * (Once accepted, the invitation row's acceptedAt is set and we ignore it —
 * the new tenant_members row takes over as `active`.)
 */
export type TenantMemberStatus = "active" | "pending" | "expired";

export type TenantMemberView = {
  /**
   * `userId` for active rows; `inv:<invitationId>` for pending/expired so the
   * FE can use it as a stable React key without colliding across kinds.
   */
  id: string;
  /** Real userId for active members; null for pending/expired (no user yet). */
  userId: string | null;
  email: string;
  name: string | null;
  role: "owner" | "member";
  status: TenantMemberStatus;
  /** ISO. For pending/expired this is the invitation createdAt. */
  joinedAt: string;
  /** Human-friendly TTL for pending invitations. e.g. "残り 18 時間". */
  expiresIn?: string;
};

function expiresInLabel(expiresAt: Date, now: Date): string {
  const diffMs = expiresAt.getTime() - now.getTime();
  if (diffMs <= 0) return "期限切れ";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `残り ${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `残り ${hours} 時間`;
  const days = Math.floor(hours / 24);
  return `残り ${days} 日`;
}

/**
 * Returns active members + open invitations as a single list, ordered active-first.
 * Pending/expired rows have no userId yet — their `id` is `inv:<invitationId>`.
 */
export async function listTenantMembers(
  database: Database,
  tenantId: string,
  now: Date = new Date(),
): Promise<TenantMemberView[]> {
  const [active, openInvitations] = await Promise.all([
    findActiveMembersForTenant(database, tenantId),
    findOpenInvitationsForTenant(database, tenantId),
  ]);

  const activeViews: TenantMemberView[] = active.map((m) => ({
    id: m.userId,
    userId: m.userId,
    email: m.email,
    name: m.name,
    role: m.role,
    status: "active",
    joinedAt: m.joinedAt.toISOString(),
  }));

  const inviteViews: TenantMemberView[] = openInvitations.map((inv) => {
    const expired = inv.expiresAt.getTime() <= now.getTime();
    return {
      id: `inv:${inv.invitationId}`,
      userId: null,
      email: inv.email,
      name: null,
      // role は invitations 表に未保存なので acceptance 時の default に揃える。
      role: "member",
      status: expired ? "expired" : "pending",
      joinedAt: inv.createdAt.toISOString(),
      expiresIn: expired ? undefined : expiresInLabel(inv.expiresAt, now),
    };
  });

  return [...activeViews, ...inviteViews];
}

// ---------------------------------------------------------------------------
// ISH-256: tenant-scope role change
// ---------------------------------------------------------------------------

/**
 * Mirror of `workspaces/usecase.ts::changeMemberRole` but tenant-scoped.
 *
 * Caller authorization (owner-only) is performed at the route layer via
 * `getTenantRole(c) === 'owner'` since `attachTenantContext` already resolved
 * the caller's role for THIS tenant. We still re-validate the target row
 * exists in this tenant before flipping the role.
 *
 * Rules:
 *   - Target must be a member of the tenant; else `not_found`.
 *   - If current role equals new role, returns `noop` (idempotent — the FE
 *     can fire this without checking the current value).
 *   - Demoting the only remaining owner → `last_owner`. The same guard
 *     applies whether the caller demotes another owner or themselves.
 */
export type ChangeTenantMemberRoleResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "last_owner" }
  | { kind: "noop" };

export async function changeTenantMemberRole(
  database: Database,
  _callerUserId: string,
  tenantId: string,
  targetUserId: string,
  newRole: TenantMemberRole,
): Promise<ChangeTenantMemberRoleResult> {
  const target = await findTenantMember(database, tenantId, targetUserId);
  if (!target) return { kind: "not_found" };

  if (target.role === newRole) return { kind: "noop" };

  if (target.role === "owner" && newRole === "member") {
    const owners = await countOwnersForTenant(database, tenantId);
    if (owners <= 1) return { kind: "last_owner" };
  }

  const updated = await updateTenantMemberRole(database, tenantId, targetUserId, newRole);
  if (!updated) return { kind: "not_found" };
  return { kind: "ok" };
}
