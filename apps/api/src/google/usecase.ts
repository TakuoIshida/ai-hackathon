import type { db as DbClient } from "@/db/client";
import { decryptSecret, encryptSecret } from "./crypto";
import {
  type CalendarFlagsPatch,
  type CalendarRow,
  clearWritesFlagOnSiblings,
  findCalendarById,
  getOauthAccountByUser,
  type OauthAccountRow,
  type StoreOauthAccountRawInput,
  updateCalendarFlagsRow,
  upsertOauthAccountRaw,
} from "./repo";

type Database = typeof DbClient;

export type UpdateCalendarFlagsResult =
  | { kind: "ok"; calendar: CalendarRow }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid"; reason: string };

/**
 * Plaintext-input variant of the OAuth account upsert. The usecase layer
 * is responsible for encrypting the refresh token before handing the
 * pre-encrypted bytes to the repo.
 */
export type UpsertOauthAccountWithEncryptionInput = {
  userId: string;
  googleUserId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
};

/**
 * Encrypt the refresh token and persist the OAuth account.
 *
 * Encryption (AES-256-GCM) is performed here so the repo only deals with
 * already-encrypted bytes — keeping the persistence layer free of
 * cryptography concerns.
 */
export async function upsertOauthAccountWithEncryption(
  database: Database,
  input: UpsertOauthAccountWithEncryptionInput,
  encryptionKey: Buffer,
): Promise<OauthAccountRow> {
  const enc = encryptSecret(input.refreshToken, encryptionKey);
  const rawInput: StoreOauthAccountRawInput = {
    userId: input.userId,
    googleUserId: input.googleUserId,
    email: input.email,
    encryptedRefreshToken: enc.ciphertext,
    refreshTokenIv: enc.iv,
    refreshTokenAuthTag: enc.authTag,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    scope: input.scope,
  };
  return upsertOauthAccountRaw(database, rawInput);
}

/**
 * Decrypt the refresh token stored on an OAuth account row.
 *
 * Lives at the usecase layer so the repo never imports `crypto`.
 */
export function decryptOauthRefreshToken(account: OauthAccountRow, encryptionKey: Buffer): string {
  return decryptSecret(
    {
      ciphertext: account.encryptedRefreshToken,
      iv: account.refreshTokenIv,
      authTag: account.refreshTokenAuthTag,
    },
    encryptionKey,
  );
}

/**
 * Apply a flags patch to a single calendar while enforcing the
 * "writes target is exclusive within an account" business invariant.
 *
 * When `patch.usedForWrites === true`, all sibling calendars on the same
 * oauth account get `usedForWrites = false` first; then the target row is
 * updated with the requested patch. Reads back the row and returns it.
 *
 * neon-http does not support callback transactions; we batch instead.
 */
export async function setCalendarFlags(
  database: Database,
  calendar: CalendarRow,
  patch: CalendarFlagsPatch,
): Promise<CalendarRow | null> {
  if (patch.usedForWrites === true) {
    await clearWritesFlagOnSiblings(database, calendar.oauthAccountId, calendar.id);
  }
  await updateCalendarFlagsRow(database, calendar.id, patch);
  return findCalendarById(database, calendar.id);
}

/**
 * Update busy/writes flags on a calendar owned by `userId`.
 *
 * Authorization: the calendar must belong to the user's connected Google
 * OAuth account. Cross-account access is rejected with `forbidden`.
 *
 * Validation: at least one flag must be present in the patch — empty patch
 * is rejected as `invalid` so the caller surfaces a 400 instead of silently
 * doing nothing.
 */
export async function updateCalendarFlagsForUser(
  database: Database,
  userId: string,
  calendarId: string,
  patch: CalendarFlagsPatch,
): Promise<UpdateCalendarFlagsResult> {
  if (patch.usedForBusy === undefined && patch.usedForWrites === undefined) {
    return { kind: "invalid", reason: "no_flags_provided" };
  }

  const account = await getOauthAccountByUser(database, userId);
  if (!account) return { kind: "forbidden" };

  const cal = await findCalendarById(database, calendarId);
  if (!cal) return { kind: "not_found" };
  if (cal.oauthAccountId !== account.id) return { kind: "forbidden" };

  const updated = await setCalendarFlags(database, cal, patch);
  if (!updated) return { kind: "not_found" };
  return { kind: "ok", calendar: updated };
}
