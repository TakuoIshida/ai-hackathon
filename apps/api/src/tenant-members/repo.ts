import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { type TenantMemberRole, tenantMembers, users } from "@/db/schema/common";
import { invitations } from "@/db/schema/tenant";

type Database = typeof DbClient;

export type ActiveMemberRow = {
  userId: string;
  email: string;
  name: string | null;
  role: "owner" | "member";
  joinedAt: Date;
};

export type OpenInvitationRow = {
  invitationId: string;
  email: string;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * Active members of `tenantId`, ordered by membership createdAt ASC so the
 * original owner appears first. Joins common.tenant_members + common.users.
 *
 * common schema has NO RLS — the tenantId filter must be explicit.
 */
export async function findActiveMembersForTenant(
  database: Database,
  tenantId: string,
): Promise<ActiveMemberRow[]> {
  const rows = await database
    .select({
      userId: tenantMembers.userId,
      email: users.email,
      name: users.name,
      role: tenantMembers.role,
      joinedAt: tenantMembers.createdAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(eq(tenantMembers.tenantId, tenantId))
    .orderBy(asc(tenantMembers.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as "owner" | "member" }));
}

/**
 * Open invitations (not yet accepted) for the tenant. tenant.invitations is in
 * the tenant schema and RLS-scoped — `attachTenantContext` 内ではフィルタが
 * 自動で効くが、cross-tenant 防御には repo 側でも tenantId を明示する。
 */
export async function findOpenInvitationsForTenant(
  database: Database,
  tenantId: string,
): Promise<OpenInvitationRow[]> {
  const rows = await database
    .select({
      invitationId: invitations.id,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), isNull(invitations.acceptedAt)))
    .orderBy(asc(invitations.createdAt));
  return rows;
}

/**
 * Single tenant_members row by (tenantId, userId). Used by ISH-251 削除 path
 * to inspect the target's role before deleting (owner はガードで弾く)。
 *
 * common schema には RLS が無いので tenantId を必ず明示する。
 */
export async function findTenantMember(
  database: Database,
  tenantId: string,
  userId: string,
): Promise<{ userId: string; role: "owner" | "member" } | null> {
  const [row] = await database
    .select({ userId: tenantMembers.userId, role: tenantMembers.role })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, role: row.role as "owner" | "member" };
}

/**
 * Deletes a (tenantId, userId) tenant_members row. Returns true if a row was
 * deleted; false if no matching row existed (caller maps that to 404).
 *
 * common.users 行は別 tenant にも所属し得るのでそのまま残す (削除しない)。
 */
export async function removeTenantMember(
  database: Database,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const deleted = await database
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .returning({ id: tenantMembers.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// ISH-256: tenant scope role change + invitation revoke
// ---------------------------------------------------------------------------

/**
 * Number of `owner` tenant_members rows in the tenant. Used to block the
 * last-owner demotion / removal so the tenant cannot end up ownerless.
 *
 * common.tenant_members has NO RLS — tenantId must be explicit.
 */
export async function countOwnersForTenant(database: Database, tenantId: string): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, "owner")));
  return row?.count ?? 0;
}

/**
 * Update a (tenantId, userId) tenant_members.role. Returns true iff a row
 * matched and was updated. The caller (usecase) is responsible for the
 * role-policy checks (caller is owner; not the last owner being demoted).
 */
export async function updateTenantMemberRole(
  database: Database,
  tenantId: string,
  userId: string,
  role: TenantMemberRole,
): Promise<boolean> {
  const result = await database
    .update(tenantMembers)
    .set({ role })
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .returning({ id: tenantMembers.id });
  return result.length > 0;
}

export type InvitationLookupRow = {
  invitationId: string;
  tenantId: string;
  email: string;
  acceptedAt: Date | null;
};

/**
 * Find an invitation by id, scoped to a tenant. tenant.invitations is RLS-
 * scoped but we keep an explicit tenantId filter for defense-in-depth.
 */
export async function findInvitationByIdForTenant(
  database: Database,
  tenantId: string,
  invitationId: string,
): Promise<InvitationLookupRow | null> {
  const [row] = await database
    .select({
      invitationId: invitations.id,
      tenantId: invitations.tenantId,
      email: invitations.email,
      acceptedAt: invitations.acceptedAt,
    })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.id, invitationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Delete an invitation row by id, scoped to a tenant. Returns true iff a row
 * was deleted.
 */
export async function deleteInvitationForTenant(
  database: Database,
  tenantId: string,
  invitationId: string,
): Promise<boolean> {
  const deleted = await database
    .delete(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.id, invitationId)))
    .returning({ id: invitations.id });
  return deleted.length > 0;
}
