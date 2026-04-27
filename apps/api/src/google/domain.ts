/**
 * Pure-domain types for the Google integration. The shape mirrors the
 * persisted rows today, but `repo.ts` owns the mappers
 * (`toOauthAccountDomain` / `toCalendarDomain`) so future schema drift does
 * not silently propagate into usecase / route layers (ISH-120).
 *
 * No imports from `drizzle-orm` or `@/db/schema/*` — only `google/repo.ts`
 * may turn rows into these types.
 */
export type OauthAccount = {
  id: string;
  userId: string;
  googleUserId: string;
  email: string;
  encryptedRefreshToken: string;
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Calendar = {
  id: string;
  oauthAccountId: string;
  googleCalendarId: string;
  summary: string | null;
  timeZone: string | null;
  isPrimary: boolean;
  usedForBusy: boolean;
  usedForWrites: boolean;
  createdAt: Date;
  updatedAt: Date;
};
