import { createClerkClient } from "@clerk/backend";
import type { db as DbClient } from "@/db/client";
import type { ClerkUserPayload, UserEntity } from "./domain";
import {
  deleteUserByClerkId as deleteUserByClerkIdRepo,
  findUserByClerkId,
  findUserById,
  insertUser,
  upsertUserFromPayload,
} from "./repo";

type Database = typeof DbClient;

export type FetchClerkUserFn = (clerkId: string) => Promise<ClerkUserPayload>;

export type EnsureUserDeps = {
  fetchClerkUser?: FetchClerkUserFn;
  clerkSecretKey?: string;
};

function defaultFetchClerkUser(clerkSecretKey: string): FetchClerkUserFn {
  return async (clerkId) => {
    const clerk = createClerkClient({ secretKey: clerkSecretKey });
    const u = await clerk.users.getUser(clerkId);
    return {
      id: clerkId,
      email_addresses: u.emailAddresses.map((e) => ({ id: e.id, email_address: e.emailAddress })),
      primary_email_address_id: u.primaryEmailAddressId ?? null,
      first_name: u.firstName ?? null,
      last_name: u.lastName ?? null,
    };
  };
}

export async function getCurrentUserByClerkId(
  database: Database,
  clerkId: string,
): Promise<UserEntity | null> {
  return findUserByClerkId(database, clerkId);
}

export async function getUserById(database: Database, id: string): Promise<UserEntity | null> {
  return findUserById(database, id);
}

export async function ensureUserByClerkId(
  database: Database,
  clerkId: string,
  deps: EnsureUserDeps = {},
): Promise<UserEntity> {
  const existing = await findUserByClerkId(database, clerkId);
  if (existing) return existing;

  const fetchClerkUser =
    deps.fetchClerkUser ??
    (() => {
      const key = deps.clerkSecretKey ?? process.env.CLERK_SECRET_KEY;
      if (!key) {
        throw new Error("CLERK_SECRET_KEY is not set; cannot lazy-fetch user from Clerk");
      }
      return defaultFetchClerkUser(key);
    })();

  const payload = await fetchClerkUser(clerkId);
  return upsertUserFromPayload(database, payload);
}

export async function applyClerkUserUpsert(
  database: Database,
  payload: ClerkUserPayload,
): Promise<UserEntity> {
  return upsertUserFromPayload(database, payload);
}

export async function applyClerkUserDelete(database: Database, clerkId: string): Promise<void> {
  await deleteUserByClerkIdRepo(database, clerkId);
}

export { insertUser };
