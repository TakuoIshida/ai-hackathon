import type { db as DbClient } from "@/db/client";
import type { IdentityProfile } from "@/ports/identity";
import type { ClerkUserPayload, User } from "./domain";
import {
  deleteUserByExternalId as deleteUserByExternalIdRepo,
  findUserByExternalId,
  findUserById,
  insertUser,
  upsertUserFromPayload,
} from "./repo";

type Database = typeof DbClient;

/**
 * Minimal port for resolving a user by their identity-provider external ID.
 *
 * Replaces `ClerkPort` (which had a Clerk-specific `fetchUser` shape) with a
 * vendor-agnostic interface backed by `IdentityProviderPort.getUserByExternalId`.
 * Tests inject a fake that satisfies this interface without any Clerk SDK.
 */
export type IdentityLookupPort = {
  getUserByExternalId: (externalId: string) => Promise<IdentityProfile | null>;
};

export async function getCurrentUserByClerkId(
  database: Database,
  clerkId: string,
): Promise<User | null> {
  return findUserByExternalId(database, clerkId);
}

export async function getUserById(database: Database, id: string): Promise<User | null> {
  return findUserById(database, id);
}

/**
 * Look up the local DB user for an identity-provider subject. If the user has
 * not been synced yet (no webhook received, fresh sign-up, etc.), the supplied
 * `port` is used to lazy-fetch the profile from the identity provider and
 * upsert a row.
 *
 * `port` is required: the usecase no longer reaches for `process.env` or the
 * Clerk SDK directly. Routes / middleware assemble a production adapter;
 * tests inject a fake.
 */
export async function ensureUserByClerkId(
  database: Database,
  clerkId: string,
  port: IdentityLookupPort,
): Promise<User> {
  const existing = await findUserByExternalId(database, clerkId);
  if (existing) return existing;

  const profile = await port.getUserByExternalId(clerkId);
  if (!profile) {
    throw new Error(`Identity provider returned no profile for user ${clerkId}`);
  }

  // Convert IdentityProfile → ClerkUserPayload for upsertUserFromPayload.
  // ClerkUserPayload is a domain type defined in users/domain.ts — it does NOT
  // import from @clerk/*, so this conversion is safe in the usecase layer.
  return upsertUserFromPayload(database, {
    id: profile.externalId,
    email_addresses: [{ id: "primary", email_address: profile.email }],
    primary_email_address_id: "primary",
    first_name: profile.firstName,
    last_name: profile.lastName,
  });
}

/**
 * Upsert a DB user from a raw Clerk webhook payload.
 * The webhook route continues to use this directly — it receives a
 * ClerkUserPayload from Clerk's svix webhook and does not go through the
 * identity port (since it is server-to-server, not via a user session).
 */
export async function applyClerkUserUpsert(
  database: Database,
  payload: ClerkUserPayload,
): Promise<User> {
  return upsertUserFromPayload(database, payload);
}

export async function applyClerkUserDelete(database: Database, clerkId: string): Promise<void> {
  await deleteUserByExternalIdRepo(database, clerkId);
}

export { insertUser };
