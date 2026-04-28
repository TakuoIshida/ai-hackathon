import type { db as DbClient } from "@/db/client";
import { insertTenantWithOwner } from "./repo";

type Database = typeof DbClient;

export type CreateTenantInput = {
  name: string;
};

export type CreateTenantResult =
  | { kind: "ok"; tenantId: string; tenantName: string; role: "owner" }
  | { kind: "already_member" }; // user is already in a tenant

/**
 * Create a new tenant and add the requesting user as the owner atomically.
 *
 * Returns `already_member` when the `common.tenant_members.user_id` UNIQUE
 * constraint fires (i.e. the user is already a member of a tenant).
 * Any other DB error is re-thrown and becomes a 500 at the HTTP layer.
 */
export async function createTenantForUser(
  database: Database,
  userId: string,
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  try {
    const result = await insertTenantWithOwner(database, {
      name: input.name,
      ownerUserId: userId,
    });
    return { kind: "ok", tenantId: result.tenantId, tenantName: result.tenantName, role: "owner" };
  } catch (err) {
    // Detect the UNIQUE(user_id) constraint violation on tenant_members.
    // postgres-js wraps the PG error in an error with a `code` property.
    if (isUniqueViolation(err, "tenant_members_user_id_unique")) {
      return { kind: "already_member" };
    }
    // Any other error (e.g. network, syntax) propagates to become a 500.
    throw err;
  }
}

/**
 * Returns true when `err` is a PostgreSQL unique_violation (23505) for the
 * given constraint name.
 *
 * postgres-js exposes the PostgreSQL error fields directly on the thrown
 * Error object, so we duck-type for the well-known `code` + `constraint_name`
 * fields without importing a postgres-js type.
 */
function isUniqueViolation(err: unknown, constraintName: string): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  // PostgreSQL SQLSTATE 23505 = unique_violation
  return e.code === "23505" && e.constraint_name === constraintName;
}
