import type { db as DbClient } from "@/db/client";
import type { ClerkUserPayload, User } from "./domain";
import {
  deleteUserByClerkId as deleteUserByClerkIdRepo,
  findUserByClerkId,
  findUserById,
  insertUser,
  upsertUserFromPayload,
} from "./repo";

type Database = typeof DbClient;

/**
 * Port for fetching a Clerk user. Route layer is responsible for assembling
 * an adapter that talks to `@clerk/backend` (or any other source) and passing
 * it in. Keeping the SDK out of the usecase mirrors the Google sinks pattern
 * in `bookings/confirm.ts` and lets unit tests inject a fake fetcher with no
 * env-var fiddling.
 */
export type ClerkPort = {
  fetchUser: (clerkId: string) => Promise<ClerkUserPayload>;
};

export async function getCurrentUserByClerkId(
  database: Database,
  clerkId: string,
): Promise<User | null> {
  return findUserByClerkId(database, clerkId);
}

export async function getUserById(database: Database, id: string): Promise<User | null> {
  return findUserById(database, id);
}

/**
 * Look up the local DB user for a Clerk subject. If the user has not been
 * synced yet (no webhook received, fresh signup, etc.), the route-supplied
 * `port` is used to lazy-fetch the Clerk profile and upsert a row.
 *
 * `port` is required: usecase no longer reaches for `process.env` or the SDK
 * directly. Routes assemble a production adapter; tests inject a fake.
 */
export async function ensureUserByClerkId(
  database: Database,
  clerkId: string,
  port: ClerkPort,
): Promise<User> {
  const existing = await findUserByClerkId(database, clerkId);
  if (existing) return existing;

  const payload = await port.fetchUser(clerkId);
  return upsertUserFromPayload(database, payload);
}

export async function applyClerkUserUpsert(
  database: Database,
  payload: ClerkUserPayload,
): Promise<User> {
  return upsertUserFromPayload(database, payload);
}

export async function applyClerkUserDelete(database: Database, clerkId: string): Promise<void> {
  await deleteUserByClerkIdRepo(database, clerkId);
}

export { insertUser };
