import { and, asc, eq, isNull } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { tenantMembers, users } from "@/db/schema/common";
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
