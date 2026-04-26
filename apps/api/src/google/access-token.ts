import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { googleOauthAccounts } from "@/db/schema/google";
import type { GoogleConfig } from "./config";
import { refreshAccessToken } from "./oauth";
import { decryptOauthRefreshToken } from "./usecase";

type Database = typeof DbClient;

const REFRESH_LEEWAY_MS = 30_000;

export async function getValidAccessToken(
  database: Database,
  cfg: GoogleConfig,
  oauthAccountId: string,
): Promise<string> {
  const [account] = await database
    .select()
    .from(googleOauthAccounts)
    .where(eq(googleOauthAccounts.id, oauthAccountId))
    .limit(1);
  if (!account) throw new Error("oauth_account_not_found");

  const expiresAt = account.accessTokenExpiresAt?.getTime() ?? 0;
  if (account.accessToken && expiresAt > Date.now() + REFRESH_LEEWAY_MS) {
    return account.accessToken;
  }

  const refresh = decryptOauthRefreshToken(account, cfg.encryptionKey);
  const refreshed = await refreshAccessToken(cfg, refresh);
  await database
    .update(googleOauthAccounts)
    .set({
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
      updatedAt: new Date(),
    })
    .where(eq(googleOauthAccounts.id, oauthAccountId));
  return refreshed.accessToken;
}
