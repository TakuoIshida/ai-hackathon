import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { type NewUser, type User as UserRow, users } from "@/db/schema/users";
import { type ClerkUserPayload, deriveUserAttributes, type User } from "./domain";

type Database = typeof DbClient;

/**
 * Row → domain mapper. Single chokepoint for all reads. Drizzle row types
 * never escape this file.
 */
function toUserDomain(row: UserRow): User {
  return {
    id: row.id,
    externalId: row.externalId,
    email: row.email,
    name: row.name,
    timeZone: row.timeZone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findUserByExternalId(
  database: Database,
  externalId: string,
): Promise<User | null> {
  const [row] = await database
    .select()
    .from(users)
    .where(eq(users.externalId, externalId))
    .limit(1);
  return row ? toUserDomain(row) : null;
}

export async function findUserById(database: Database, id: string): Promise<User | null> {
  const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUserDomain(row) : null;
}

export async function insertUser(
  database: Database,
  attrs: Pick<NewUser, "externalId" | "email" | "name">,
): Promise<User> {
  const [created] = await database
    .insert(users)
    .values(attrs)
    .onConflictDoUpdate({
      target: users.externalId,
      set: { email: attrs.email, name: attrs.name ?? null, updatedAt: new Date() },
    })
    .returning();
  if (!created) throw new Error("failed to upsert user");
  return toUserDomain(created);
}

export async function upsertUserFromPayload(
  database: Database,
  payload: ClerkUserPayload,
): Promise<User> {
  return insertUser(database, deriveUserAttributes(payload));
}

export async function deleteUserByExternalId(
  database: Database,
  externalId: string,
): Promise<void> {
  await database.delete(users).where(eq(users.externalId, externalId));
}

// ---------------------------------------------------------------------------
// Legacy aliases for backward compatibility during migration.
// These will be removed once all callsites have been updated.
// ---------------------------------------------------------------------------

/** @deprecated Use findUserByExternalId instead. */
export async function findUserByClerkId(database: Database, clerkId: string): Promise<User | null> {
  return findUserByExternalId(database, clerkId);
}

/** @deprecated Use deleteUserByExternalId instead. */
export async function deleteUserByClerkId(database: Database, clerkId: string): Promise<void> {
  return deleteUserByExternalId(database, clerkId);
}
