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
    clerkId: row.clerkId,
    email: row.email,
    name: row.name,
    timeZone: row.timeZone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findUserByClerkId(database: Database, clerkId: string): Promise<User | null> {
  const [row] = await database.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ? toUserDomain(row) : null;
}

export async function findUserById(database: Database, id: string): Promise<User | null> {
  const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUserDomain(row) : null;
}

export async function insertUser(
  database: Database,
  attrs: Pick<NewUser, "clerkId" | "email" | "name">,
): Promise<User> {
  const [created] = await database
    .insert(users)
    .values(attrs)
    .onConflictDoUpdate({
      target: users.clerkId,
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

export async function deleteUserByClerkId(database: Database, clerkId: string): Promise<void> {
  await database.delete(users).where(eq(users.clerkId, clerkId));
}
