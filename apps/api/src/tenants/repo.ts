import type { db as DbClient } from "@/db/client";
import { tenantMembers, tenants } from "@/db/schema/common";

type Database = typeof DbClient;

export type CreateTenantRepoInput = {
  name: string;
  ownerUserId: string;
};

export type CreateTenantRepoResult = {
  tenantId: string;
  tenantName: string;
};

/**
 * Inserts a new common.tenants row and a common.tenant_members row for the
 * owner atomically within a single transaction.
 *
 * Throws a DB error when the `tenant_members.user_id` UNIQUE constraint is
 * violated (i.e. the user is already a member of another tenant). The caller
 * (usecase) is responsible for detecting the specific constraint violation and
 * converting it to a domain result.
 */
export async function insertTenantWithOwner(
  database: Database,
  input: CreateTenantRepoInput,
): Promise<CreateTenantRepoResult> {
  const result = await database.transaction(async (tx) => {
    const [tenant] = await tx.insert(tenants).values({ name: input.name }).returning();
    if (!tenant) throw new Error("tenant insert returned no row");
    await tx.insert(tenantMembers).values({
      userId: input.ownerUserId,
      tenantId: tenant.id,
      role: "owner",
    });
    return tenant;
  });
  return { tenantId: result.id, tenantName: result.name };
}
