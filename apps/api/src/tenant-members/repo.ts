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
