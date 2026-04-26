import { and, eq, isNull } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import {
  type Invitation,
  invitations,
  type Membership,
  memberships,
  type Workspace,
  workspaces,
} from "@/db/schema/workspaces";

type Database = typeof DbClient;
type BatchQuery = Parameters<Database["batch"]>[0][number];

export type WorkspaceRow = Workspace;
export type MembershipRow = Membership;
export type InvitationRow = Invitation;

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

/**
 * ISH-109: accept an invitation atomically. Inserts the membership row
 * (skipping the unique-key conflict if the user is already a member of the
 * workspace) AND marks the invitation as accepted in a single batch so partial
 * failures cannot leave the system half-redeemed.
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
      .where(eq(invitations.id, params.invitationId)),
  ];
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
}
