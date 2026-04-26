import type { db as DbClient } from "@/db/client";
import type { CalendarListItem } from "./calendar";
import type { GoogleConfig } from "./config";
import { decryptSecret, encryptSecret } from "./crypto";
import { buildAuthUrl, type GoogleUserInfo, hasRequiredScopes, type TokenResponse } from "./oauth";
import {
  type CalendarFlagsPatch,
  type CalendarRow,
  clearWritesFlagOnSiblings,
  deleteOauthAccount,
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

// ---------------------------------------------------------------------------
// OAuth flow usecases (ISH-127)
//
// The /connect, /callback, /disconnect HTTP handlers used to inline the entire
// OAuth dance — token exchange, userinfo, upsert, calendar sync, revoke. The
// route layer should only deal with parsing input, cookies, and redirects;
// everything else moves here so it is unit-testable without spinning up Hono.
//
// Side effects (Google network calls + DB writes) are injected via a single
// `OauthSinks` ports object, mirroring the `GoogleSinks` pattern from
// bookings/confirm.ts. Callers in production wire the real implementations
// from @/google/oauth and @/google/calendar; tests pass fakes.
// ---------------------------------------------------------------------------

export type ExchangeCodeFn = (cfg: GoogleConfig, code: string) => Promise<TokenResponse>;
export type FetchUserInfoFn = (accessToken: string) => Promise<GoogleUserInfo>;
export type ListCalendarsFn = (accessToken: string) => Promise<CalendarListItem[]>;
export type SyncCalendarsFn = (
  database: Database,
  oauthAccountId: string,
  list: ReadonlyArray<CalendarListItem>,
) => Promise<void>;
export type RevokeTokenFn = (token: string) => Promise<void>;

export type OauthSinks = {
  exchangeCodeForTokens: ExchangeCodeFn;
  fetchUserInfo: FetchUserInfoFn;
  listCalendars: ListCalendarsFn;
  syncCalendars: SyncCalendarsFn;
  revokeToken: RevokeTokenFn;
};

/**
 * Build the Google OAuth consent URL for `/connect`.
 *
 * Pure helper — no I/O. Kept here so the route layer doesn't import
 * @/google/oauth directly and so the OAuth namespace lives in one place.
 */
export function buildOauthAuthUrl(cfg: GoogleConfig, state: string): string {
  return buildAuthUrl(cfg, state);
}

export type CompleteOauthCallbackResult =
  | { kind: "ok"; account: OauthAccountRow; redirectTo: string }
  | { kind: "invalid_state" }
  | { kind: "missing_code" }
  | { kind: "missing_refresh_token" }
  | { kind: "missing_scopes" };

export type CompleteOauthCallbackInput = {
  cookieState: string | undefined;
  queryState: string | undefined;
  code: string | undefined;
  userId: string;
};

/**
 * Run the entire `/callback` flow: state check → token exchange → userinfo →
 * upsert account → initial calendar sync. Returns a discriminated union so
 * the caller can map outcomes to HTTP status codes without leaking domain
 * logic into the route.
 *
 * Best-effort calendar sync: a listCalendars/syncCalendars failure does NOT
 * fail the connection — the row is already persisted and the user can retry
 * sync from the dashboard. We log + continue, matching the original behavior
 * which would have left the row in place if the sync threw.
 */
export async function completeOauthCallback(
  database: Database,
  cfg: GoogleConfig,
  input: CompleteOauthCallbackInput,
  ports: OauthSinks,
): Promise<CompleteOauthCallbackResult> {
  const { cookieState, queryState, code, userId } = input;
  if (!cookieState || !queryState || cookieState !== queryState) {
    return { kind: "invalid_state" };
  }
  if (!code) return { kind: "missing_code" };

  const tokens = await ports.exchangeCodeForTokens(cfg, code);
  if (!tokens.refreshToken) return { kind: "missing_refresh_token" };
  if (!hasRequiredScopes(tokens.scope)) return { kind: "missing_scopes" };

  const userInfo = await ports.fetchUserInfo(tokens.accessToken);

  const account = await upsertOauthAccountWithEncryption(
    database,
    {
      userId,
      googleUserId: userInfo.sub,
      email: userInfo.email,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      scope: tokens.scope,
    },
    cfg.encryptionKey,
  );

  try {
    const calendarList = await ports.listCalendars(tokens.accessToken);
    await ports.syncCalendars(database, account.id, calendarList);
  } catch (err) {
    console.warn("[google] initial calendar sync failed; account kept connected:", err);
  }

  return {
    kind: "ok",
    account,
    redirectTo: `${cfg.appBaseUrl}/dashboard/settings?google_connected=1`,
  };
}

export type DisconnectGoogleAccountResult = { kind: "ok" } | { kind: "already_disconnected" };

/**
 * Revoke the refresh token (best-effort) and delete the local oauth row.
 *
 * The original `/disconnect` swallowed revoke errors so the local row would
 * still be removed — we preserve that contract here. Callers should treat
 * either result kind as a 200 OK; the kind is exposed only so the response
 * body can echo `alreadyDisconnected` for idempotency.
 */
export async function disconnectGoogleAccount(
  database: Database,
  cfg: GoogleConfig,
  userId: string,
  ports: Pick<OauthSinks, "revokeToken">,
): Promise<DisconnectGoogleAccountResult> {
  const account = await getOauthAccountByUser(database, userId);
  if (!account) return { kind: "already_disconnected" };

  try {
    const refresh = decryptOauthRefreshToken(account, cfg.encryptionKey);
    await ports.revokeToken(refresh);
  } catch (err) {
    console.warn("[google] revoke failed (will still delete row):", err);
  }
  await deleteOauthAccount(database, userId, account.googleUserId);
  return { kind: "ok" };
}
