import { and, eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { googleCalendars, googleOauthAccounts } from "@/db/schema/google";
import type { CalendarListItem } from "./calendar";
import { decryptSecret, encryptSecret } from "./crypto";

type Database = typeof DbClient;

export type OauthAccountRow = typeof googleOauthAccounts.$inferSelect;
export type CalendarRow = typeof googleCalendars.$inferSelect;

export type StoreOauthAccountInput = {
  userId: string;
  googleUserId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
  encryptionKey: Buffer;
};

export async function upsertOauthAccount(
  database: Database,
  input: StoreOauthAccountInput,
): Promise<OauthAccountRow> {
  const enc = encryptSecret(input.refreshToken, input.encryptionKey);
  const [row] = await database
    .insert(googleOauthAccounts)
    .values({
      userId: input.userId,
      googleUserId: input.googleUserId,
      email: input.email,
      encryptedRefreshToken: enc.ciphertext,
      refreshTokenIv: enc.iv,
      refreshTokenAuthTag: enc.authTag,
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scope: input.scope,
    })
    .onConflictDoUpdate({
      target: [googleOauthAccounts.userId, googleOauthAccounts.googleUserId],
      set: {
        email: input.email,
        encryptedRefreshToken: enc.ciphertext,
        refreshTokenIv: enc.iv,
        refreshTokenAuthTag: enc.authTag,
        accessToken: input.accessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        scope: input.scope,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("failed to upsert google_oauth_accounts");
  return row;
}

export async function getOauthAccountByUser(
  database: Database,
  userId: string,
): Promise<OauthAccountRow | null> {
  const [row] = await database
    .select()
    .from(googleOauthAccounts)
    .where(eq(googleOauthAccounts.userId, userId))
    .limit(1);
  return row ?? null;
}

export function decryptRefreshToken(row: OauthAccountRow, encryptionKey: Buffer): string {
  return decryptSecret(
    {
      ciphertext: row.encryptedRefreshToken,
      iv: row.refreshTokenIv,
      authTag: row.refreshTokenAuthTag,
    },
    encryptionKey,
  );
}

export async function deleteOauthAccount(
  database: Database,
  userId: string,
  googleUserId: string,
): Promise<void> {
  await database
    .delete(googleOauthAccounts)
    .where(
      and(
        eq(googleOauthAccounts.userId, userId),
        eq(googleOauthAccounts.googleUserId, googleUserId),
      ),
    );
}

export async function syncCalendars(
  database: Database,
  oauthAccountId: string,
  list: ReadonlyArray<CalendarListItem>,
): Promise<void> {
  if (list.length === 0) return;
  await database
    .insert(googleCalendars)
    .values(
      list.map((c) => ({
        oauthAccountId,
        googleCalendarId: c.id,
        summary: c.summary,
        timeZone: c.timeZone,
        isPrimary: c.primary,
        usedForBusy: true,
        usedForWrites: c.primary,
      })),
    )
    .onConflictDoUpdate({
      target: [googleCalendars.oauthAccountId, googleCalendars.googleCalendarId],
      set: { summary: googleCalendars.summary, updatedAt: new Date() },
    });
}

export async function listUserCalendars(
  database: Database,
  oauthAccountId: string,
): Promise<CalendarRow[]> {
  return database
    .select()
    .from(googleCalendars)
    .where(eq(googleCalendars.oauthAccountId, oauthAccountId));
}
