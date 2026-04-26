import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { users } from "@/db/schema/users";
import {
  type Invitation,
  invitations,
  type Membership,
  type MembershipRole,
  memberships,
  type Workspace,
  workspaces,
} from "@/db/schema/workspaces";

type Database = typeof DbClient;
type BatchQuery = Parameters<Database["batch"]>[0][number];

export type WorkspaceRow = Workspace;
export type MembershipRow = Membership;
export type InvitationRow = Invitation;

// Postgres unique-violation SQLSTATE. neon-http and pglite both surface this
// as `code` on the thrown error.
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code === PG_UNIQUE_VIOLATION;
}

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  ownerUserId: string;
};

export type CreateWorkspaceResult =
  | { kind: "ok"; workspace: WorkspaceRow }
  | { kind: "slug_taken" };

// neon-http does not support callback transactions; we use db.batch (atomic,
// single HTTP req) to insert the workspace + the owner membership row in one
// shot. Slug uniqueness is enforced by a DB UNIQUE constraint on
// workspaces.slug — we translate that into a structured `slug_taken` result.
// (`BatchQuery` is declared once at the top of this module.)

export async function createWorkspaceWithOwnerMembership(
  database: Database,
  input: CreateWorkspaceInput,
): Promise<CreateWorkspaceResult> {
  const workspaceId = randomUUID();
  const queries: [BatchQuery, ...BatchQuery[]] = [
    database.insert(workspaces).values({
      id: workspaceId,
      name: input.name,
      slug: input.slug,
      ownerUserId: input.ownerUserId,
    }),
    database.insert(memberships).values({
      workspaceId,
      userId: input.ownerUserId,
      role: "owner",
    }),
  ];
  try {
    await database.batch(queries);
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "slug_taken" };
    throw err;
  }
  const workspace = await findWorkspaceById(database, workspaceId);
  if (!workspace) throw new Error("workspace disappeared after insert");
  return { kind: "ok", workspace };
}

export type WorkspaceWithRole = {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  createdAt: Date;
};

/**
 * Workspaces the user is a member of, with their role for each. Ordered by
 * membership createdAt ascending so the user's earliest workspace is first.
 */
export async function listMembershipsForUser(
  database: Database,
  userId: string,
): Promise<WorkspaceWithRole[]> {
  const rows = await database
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: memberships.role,
      createdAt: workspaces.createdAt,
      membershipCreatedAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(eq(memberships.userId, userId));
  // Sort in JS to keep the query simple; member counts are tiny per user.
  rows.sort((a, b) => a.membershipCreatedAt.getTime() - b.membershipCreatedAt.getTime());
  return rows.map(({ membershipCreatedAt: _ignored, ...row }) => row);
}

export async function getWorkspaceForMember(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceWithRole | null> {
  const [row] = await database
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: memberships.role,
      createdAt: workspaces.createdAt,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function findWorkspaceById(
  database: Database,
  workspaceId: string,
): Promise<WorkspaceRow | null> {
  const [row] = await database
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function findMembership(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const [row] = await database
    .select()
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
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
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .returning({ id: memberships.id });
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
 * by `memberships.createdAt` ASC so the original owner appears first and
 * subsequent joiners follow in the order they accepted.
 */
export async function listMembersWithUserInfo(
  database: Database,
  workspaceId: string,
): Promise<WorkspaceMemberRow[]> {
  const rows = await database
    .select({
      userId: memberships.userId,
      email: users.email,
      name: users.name,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(asc(memberships.createdAt));
  return rows;
}

/**
 * ISH-110: delete a single (workspace, user) membership row.
 * Returns true when a row was actually deleted, false otherwise — the
 * usecase layer maps the latter to `not_found`.
 */
export async function removeMembership(
  database: Database,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const deleted = await database
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .returning({ id: memberships.id });
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
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")));
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
        eq(invitations.workspaceId, workspaceId),
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
  workspaceId: string;
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
 * ISH-109: accept an invitation atomically. Inserts the membership row
 * (skipping the unique-key conflict if the user is already a member of the
 * workspace) AND marks the invitation as accepted in a single batch so partial
 * failures cannot leave the system half-redeemed.
 *
 * The UPDATE has a `accepted_at IS NULL` guard so a concurrent second accept
 * (which the read-then-write window in the usecase cannot itself prevent on
 * neon-http) becomes a no-op rather than overwriting the original
 * acceptance timestamp. The membership ON CONFLICT covers double-insert.
 *
 * neon-http does not support callback transactions; `db.batch` is the atomic
 * unit (see `links/repo.ts::createLink`). The PGlite test harness in
 * `test/integration-db.ts` shims `batch` to sequential awaits.
 */
export async function acceptInvitationAtomic(
  database: Database,
  params: { invitationId: string; userId: string; workspaceId: string; now: Date },
): Promise<void> {
  const queries: BatchQuery[] = [
    database
      .insert(memberships)
      .values({
        workspaceId: params.workspaceId,
        userId: params.userId,
        role: "member",
      })
      .onConflictDoNothing({ target: [memberships.workspaceId, memberships.userId] }),
    database
      .update(invitations)
      .set({ acceptedAt: params.now })
      .where(and(eq(invitations.id, params.invitationId), isNull(invitations.acceptedAt))),
  ];
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
}
