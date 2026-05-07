import { and, eq, isNull } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { type TenantMemberRole, tenantMembers } from "@/db/schema/common";
import { type Invitation, invitations } from "@/db/schema/tenant";

type Database = typeof DbClient;
type BatchQuery = Parameters<Database["batch"]>[0][number];

// ---------------------------------------------------------------------------
// Invitation reads
// ---------------------------------------------------------------------------

/**
 * Look up a tenant.invitations row by its token.
 *
 * Must be called with the baseline `db` (NOT via requestScope tx) because this
 * endpoint is used during invitation acceptance — the invitee has no
 * tenant_members row yet so attachTenantContext is not mounted on the accept
 * route. The baseline db bypasses RLS.
 */
export async function findOpenInvitationByToken(
  database: Database,
  token: string,
): Promise<Invitation | null> {
  const [row] = await database
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  return row ?? null;
}

/**
 * ISH-261: lookup the full invitation row scoped to a tenant. Used by the
 * resend usecase which needs the token + email + acceptedAt + expiresAt.
 *
 * tenant.invitations is RLS-scoped via attachTenantContext, but we keep an
 * explicit tenantId filter here for defense-in-depth (cross-tenant probing).
 */
export async function findInvitationByIdForTenant(
  database: Database,
  tenantId: string,
  invitationId: string,
): Promise<Invitation | null> {
  const [row] = await database
    .select()
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.id, invitationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Find an open (not yet accepted) invitation for a given (tenant, email) pair.
 * Used by createInvitation to detect duplicates before INSERT.
 */
export async function findOpenInvitationByEmail(
  database: Database,
  tenantId: string,
  email: string,
): Promise<Invitation | null> {
  const [row] = await database
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.tenantId, tenantId),
        eq(invitations.email, email),
        isNull(invitations.acceptedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Invitation writes
// ---------------------------------------------------------------------------

export type InsertInvitationInput = {
  tenantId: string;
  email: string;
  invitedByUserId: string;
  expiresAt: Date;
  /** ISH-252: persist requested role so acceptInvitation can read it back. */
  role: TenantMemberRole;
};

export async function insertInvitation(
  database: Database,
  input: InsertInvitationInput,
): Promise<Invitation> {
  const [row] = await database
    .insert(invitations)
    .values({
      tenantId: input.tenantId,
      email: input.email,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      role: input.role,
      // token uses defaultRandom() in schema
    })
    .returning();
  if (!row) throw new Error("failed to insert invitation");
  return row;
}

/**
 * ISH-261: extend an invitation's `expiresAt` (typically by 24h on resend).
 * Caller is responsible for the open / not-accepted check beforehand.
 *
 * Returns true iff a row matched and was updated.
 */
export async function updateInvitationExpiry(
  database: Database,
  invitationId: string,
  expiresAt: Date,
): Promise<boolean> {
  const updated = await database
    .update(invitations)
    .set({ expiresAt })
    .where(eq(invitations.id, invitationId))
    .returning({ id: invitations.id });
  return updated.length > 0;
}

/**
 * Mark an invitation as accepted and insert a tenant_members row atomically.
 *
 * Uses db.batch so the two statements execute inside the same DB transaction.
 * If the user is already a member (UNIQUE(user_id) conflict), the INSERT is
 * silently skipped via ON CONFLICT DO NOTHING — the row was created by a prior
 * acceptance or direct admin add. The caller validates the UNIQUE constraint
 * violation before this function is called (via a pre-check), so this is only
 * a safety net for race conditions.
 */
export async function markInvitationAccepted(
  database: Database,
  params: {
    invitationId: string;
    userId: string;
    tenantId: string;
    role: TenantMemberRole;
    now: Date;
  },
): Promise<void> {
  const queries: BatchQuery[] = [
    database
      .insert(tenantMembers)
      .values({
        userId: params.userId,
        tenantId: params.tenantId,
        role: params.role,
      })
      .onConflictDoNothing({ target: [tenantMembers.userId] }),
    database
      .update(invitations)
      .set({ acceptedAt: params.now })
      .where(and(eq(invitations.id, params.invitationId), isNull(invitations.acceptedAt))),
  ];
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
}
