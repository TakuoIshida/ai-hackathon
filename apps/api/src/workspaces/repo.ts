import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import {
  type Tenant,
  type TenantMember,
  type TenantMemberRole,
  tenantMembers,
  tenants,
} from "@/db/schema/common";
import { users } from "@/db/schema/users";
import { type Invitation, invitations } from "@/db/schema/workspaces";

type Database = typeof DbClient;
type BatchQuery = Parameters<Database["batch"]>[0][number];

export type WorkspaceRow = Tenant;
export type MembershipRow = TenantMember;
export type InvitationRow = Invitation;
export type MembershipRole = TenantMemberRole;

export type CreateWorkspaceInput = {
  name: string;
  ownerUserId: string;
};

export type CreateWorkspaceResult = { kind: "ok"; workspace: WorkspaceRow };

/**
 * Inserts a new tenant and its initial owner membership atomically using a
 * transaction. Throws if the owner already belongs to another tenant (the DB
 * UNIQUE(user_id) constraint on tenant_members enforces 1 user = 1 tenant).
 */
export async function createWorkspaceWithOwnerMembership(
  database: Database,
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> {
  // We can't use batch for two dependent inserts (need tenant id from first).
  // Use a transaction instead.
  const workspace = await database.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: input.name }).returning();
    if (!tenant) throw new Error("tenant insert returned no row");
    await tx.insert(tenantMembers).values({
      userId: input.ownerUserId,
      tenantId: tenant.id,
      role: "owner",
    });
    return tenant;
  });
  return { kind: "ok", workspace };
}

export type WorkspaceWithRole = {
  id: string;
  name: string;
  /** @deprecated slug removed from common.tenants (ISH-168). Always empty string. */
  slug: string;
  role: MembershipRole;
  createdAt: Date;
};

/**
 * Workspaces the user is a member of, with their role. Since 1 user = 1 tenant,
 * this returns at most one entry. Ordered by membership createdAt ascending.
 */
export async function listMembershipsForUser(
  database: Database,
  userId: string,
): Promise<WorkspaceWithRole[]> {
  const rows = await database
    .select({
      id: tenants.id,
      name: tenants.name,
      role: tenantMembers.role,
      createdAt: tenants.createdAt,
      membershipCreatedAt: tenantMembers.createdAt,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(eq(tenantMembers.userId, userId));
  rows.sort((a, b) => a.membershipCreatedAt.getTime() - b.membershipCreatedAt.getTime());
  return rows.map(({ membershipCreatedAt: _ignored, ...row }) => ({
    ...row,
    slug: "", // slug removed from common.tenants (ISH-168)
    role: row.role as MembershipRole,
  }));
}

export async function getWorkspaceForMember(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceWithRole | null> {
  const [row] = await database
    .select({
      id: tenants.id,
      name: tenants.name,
      role: tenantMembers.role,
      createdAt: tenants.createdAt,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, workspaceId)))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    slug: "", // slug removed from common.tenants (ISH-168)
    role: row.role as MembershipRole,
  };
}

export async function findWorkspaceById(
  database: Database,
  workspaceId: string,
): Promise<WorkspaceRow | null> {
  const [row] = await database.select().from(tenants).where(eq(tenants.id, workspaceId)).limit(1);
  return row ?? null;
}

export async function findMembership(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const [row] = await database
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, workspaceId), eq(tenantMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * ISH-111: change a member's role. Returns true iff a row matched and was
 * updated. The caller (usecase) is responsible for the role-policy checks
 * (caller is owner; not the last owner being demoted; etc.).
 */
export async function updateMembershipRole(
  database: Database,
  workspaceId: string,
  userId: string,
  role: MembershipRole,
): Promise<boolean> {
  const result = await database
    .update(tenantMembers)
    .set({ role })
    .where(and(eq(tenantMembers.tenantId, workspaceId), eq(tenantMembers.userId, userId)))
    .returning({ id: tenantMembers.id });
  return result.length > 0;
}

export type WorkspaceMemberRow = {
  userId: string;
  email: string;
  name: string | null;
  role: MembershipRole;
  createdAt: Date;
};

/**
 * ISH-110: list members of a workspace, joined with their user info. Ordered
 * by `tenant_members.createdAt` ASC so the original owner appears first and
 * subsequent joiners follow in the order they accepted.
 */
export async function listMembersWithUserInfo(
  database: Database,
  workspaceId: string,
): Promise<WorkspaceMemberRow[]> {
  const rows = await database
    .select({
      userId: tenantMembers.userId,
      email: users.email,
      name: users.name,
      role: tenantMembers.role,
      createdAt: tenantMembers.createdAt,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(eq(tenantMembers.tenantId, workspaceId))
    .orderBy(asc(tenantMembers.createdAt));
  return rows.map((r) => ({ ...r, role: r.role as MembershipRole }));
}

/**
 * ISH-110: delete a single (workspace, user) tenant_members row.
 * Returns true when a row was actually deleted, false otherwise — the
 * usecase layer maps the latter to `not_found`.
 */
export async function removeMembership(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const deleted = await database
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, workspaceId), eq(tenantMembers.userId, userId)))
    .returning({ id: tenantMembers.id });
  return deleted.length > 0;
}

/**
 * Number of `owner` memberships in the workspace. Used by both ISH-110
 * (block last-owner removal) and ISH-111 (block last-owner demotion).
 */
export async function countOwnersForWorkspace(
  database: Database,
  workspaceId: string,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, workspaceId), eq(tenantMembers.role, "owner")));
  return row?.count ?? 0;
}

export async function findOpenInvitationForEmail(
  database: Database,
  workspaceId: string,
  email: string,
): Promise<InvitationRow | null> {
  const [row] = await database
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, workspaceId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findInvitationByToken(
  database: Database,
  token: string,
): Promise<InvitationRow | null> {
  const [row] = await database
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  return row ?? null;
}

export type CreateInvitationInput = {
  tenantId: string;
  email: string;
  invitedByUserId: string;
  expiresAt: Date;
};

export async function createInvitation(
  database: Database,
  input: CreateInvitationInput,
): Promise<InvitationRow> {
  const [row] = await database.insert(invitations).values(input).returning();
  if (!row) throw new Error("failed to insert invitation");
  return row;
}

export async function deleteInvitation(database: Database, id: string): Promise<void> {
  await database.delete(invitations).where(eq(invitations.id, id));
}

/**
 * ISH-109: accept an invitation atomically. Inserts the tenant_members row
 * (skipping the unique-key conflict if the user is already a member of the
 * tenant) AND marks the invitation as accepted in a single batch so partial
 * failures cannot leave the system half-redeemed.
 *
 * The UPDATE has a `accepted_at IS NULL` guard so a concurrent second accept
 * (which the read-then-write window in the usecase cannot itself prevent)
 * becomes a no-op rather than overwriting the original acceptance timestamp.
 * The membership ON CONFLICT covers double-insert.
 *
 * `db.batch` is the atomic unit (see `links/repo.ts::createLink`). It wraps a
 * postgres-js callback transaction in production; the test harness in
 * `test/integration-db.ts` installs the same transactional shim so tests
 * exercise the same atomicity guarantees.
 */
export async function acceptInvitationAtomic(
  database: Database,
  params: { invitationId: string; userId: string; workspaceId: string; now: Date },
): Promise<void> {
  const queries: BatchQuery[] = [
    database
      .insert(tenantMembers)
      .values({
        userId: params.userId,
        tenantId: params.workspaceId,
        role: "member",
      })
      .onConflictDoNothing({ target: [tenantMembers.userId] }),
    database
      .update(invitations)
      .set({ acceptedAt: params.now })
      .where(and(eq(invitations.id, params.invitationId), isNull(invitations.acceptedAt))),
  ];
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
}
