import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { users } from "@/db/schema/users";

export type ClerkUserPayload = {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type Database = typeof DbClient;

export function pickPrimaryEmail(payload: ClerkUserPayload): string | null {
  const primary = payload.email_addresses.find((e) => e.id === payload.primary_email_address_id);
  if (primary) return primary.email_address;
  return payload.email_addresses[0]?.email_address ?? null;
}

export function buildDisplayName(payload: ClerkUserPayload): string | null {
  const first = payload.first_name?.trim() ?? "";
  const last = payload.last_name?.trim() ?? "";
  const combined = [first, last].filter(Boolean).join(" ");
  return combined.length > 0 ? combined : null;
}

export async function upsertUserFromClerk(database: Database, payload: ClerkUserPayload) {
  const email = pickPrimaryEmail(payload);
  if (!email) {
    throw new Error(`Clerk user ${payload.id} has no email addresses`);
  }
  const name = buildDisplayName(payload);
  await database
    .insert(users)
    .values({ clerkId: payload.id, email, name })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: { email, name, updatedAt: new Date() },
    });
}

export async function deleteUserByClerkId(database: Database, clerkId: string): Promise<void> {
  await database.delete(users).where(eq(users.clerkId, clerkId));
}
