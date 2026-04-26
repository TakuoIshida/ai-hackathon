import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
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
type BatchQuery = Parameters<Database["batch"]>[0][number];

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
