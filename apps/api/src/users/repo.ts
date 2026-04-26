import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { users } from "@/db/schema/users";
import {
  type ClerkUserPayload,
  deriveUserAttributes,
  type NewUserAttributes,
  type UserEntity,
} from "./domain";

type Database = typeof DbClient;

export async function findUserByClerkId(
  database: Database,
  clerkId: string,
): Promise<UserEntity | null> {
  const [row] = await database.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ?? null;
}

export async function findUserById(database: Database, id: string): Promise<UserEntity | null> {
  const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function insertUser(
  database: Database,
  attrs: Pick<NewUserAttributes, "clerkId" | "email" | "name">,
): Promise<UserEntity> {
  const [created] = await database
    .insert(users)
    .values(attrs)
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email: attrs.email, name: attrs.name ?? null, updatedAt: new Date() },
    })
    .returning();
  if (!created) throw new Error("failed to upsert user");
  return created;
}

export async function upsertUserFromPayload(
  database: Database,
  payload: ClerkUserPayload,
): Promise<UserEntity> {
  return insertUser(database, deriveUserAttributes(payload));
}

export async function deleteUserByClerkId(database: Database, clerkId: string): Promise<void> {
  await database.delete(users).where(eq(users.clerkId, clerkId));
}
