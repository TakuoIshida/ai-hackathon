import { createClerkClient } from "@clerk/backend";
import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { users } from "@/db/schema/users";
import { buildDisplayName, pickPrimaryEmail } from "./sync";

type Database = typeof DbClient;

export type DbUser = typeof users.$inferSelect;

export async function getUserByClerkId(
  database: Database,
  clerkId: string,
): Promise<DbUser | null> {
  const [row] = await database.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return row ?? null;
}

export async function getUserById(database: Database, id: string): Promise<DbUser | null> {
  const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function ensureUserByClerkId(
  database: Database,
  clerkId: string,
  clerkSecretKey: string | undefined = process.env.CLERK_SECRET_KEY,
): Promise<DbUser> {
  const existing = await getUserByClerkId(database, clerkId);
  if (existing) return existing;

  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is not set; cannot lazy-fetch user from Clerk");
  }
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const u = await clerk.users.getUser(clerkId);

  const payload = {
    id: clerkId,
    email_addresses: u.emailAddresses.map((e) => ({ id: e.id, email_address: e.emailAddress })),
    primary_email_address_id: u.primaryEmailAddressId ?? null,
    first_name: u.firstName ?? null,
    last_name: u.lastName ?? null,
  };
  const email = pickPrimaryEmail(payload);
  if (!email) throw new Error(`Clerk user ${clerkId} has no email`);
  const name = buildDisplayName(payload);

  const [created] = await database
    .insert(users)
    .values({ clerkId, email, name })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email, name, updatedAt: new Date() },
    })
    .returning();
  if (!created) throw new Error("failed to upsert user");
  return created;
}
