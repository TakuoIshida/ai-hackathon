import { and, eq, sql } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import {
  type GoogleCalendar as CalendarTableRow,
  googleCalendars,
  googleOauthAccounts,
  type GoogleOauthAccount as OauthAccountTableRow,
} from "@/db/schema/google";
import type { CalendarListItem } from "./calendar";
import type { Calendar, OauthAccount } from "./domain";

type Database = typeof DbClient;

/**
 * Row → domain mappers. Single chokepoints: every read funnels through these
 * so the persistence shape never escapes `repo.ts`. Domain types happen to
 * mirror the rows today; the indirection lets schema drift stay local.
 */
function toOauthAccountDomain(row: OauthAccountTableRow): OauthAccount {
  return {
    id: row.id,
    userId: row.userId,
    googleUserId: row.googleUserId,
    email: row.email,
    encryptedRefreshToken: row.encryptedRefreshToken,
    refreshTokenIv: row.refreshTokenIv,
    refreshTokenAuthTag: row.refreshTokenAuthTag,
    accessToken: row.accessToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    scope: row.scope,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCalendarDomain(row: CalendarTableRow): Calendar {
  return {
    id: row.id,
    oauthAccountId: row.oauthAccountId,
    googleCalendarId: row.googleCalendarId,
    summary: row.summary,
    timeZone: row.timeZone,
    isPrimary: row.isPrimary,
    usedForBusy: row.usedForBusy,
    usedForWrites: row.usedForWrites,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Pre-encrypted refresh-token payload + the rest of the OAuth account row.
 *
 * Encryption happens in the usecase layer; this repo function only knows
 * how to persist the already-encrypted bytes.
 */
export type StoreOauthAccountRawInput = {
  userId: string;
  googleUserId: string;
  email: string;
  encryptedRefreshToken: string;
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
};

export async function upsertOauthAccountRaw(
  database: Database,
  input: StoreOauthAccountRawInput,
): Promise<OauthAccount> {
  const [row] = await database
    .insert(googleOauthAccounts)
    .values({
      userId: input.userId,
      googleUserId: input.googleUserId,
      email: input.email,
      encryptedRefreshToken: input.encryptedRefreshToken,
      refreshTokenIv: input.refreshTokenIv,
      refreshTokenAuthTag: input.refreshTokenAuthTag,
      accessToken: input.accessToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      scope: input.scope,
    })
    .onConflictDoUpdate({
      target: [googleOauthAccounts.userId, googleOauthAccounts.googleUserId],
      set: {
        email: input.email,
        encryptedRefreshToken: input.encryptedRefreshToken,
        refreshTokenIv: input.refreshTokenIv,
        refreshTokenAuthTag: input.refreshTokenAuthTag,
        accessToken: input.accessToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        scope: input.scope,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("failed to upsert google_oauth_accounts");
  return toOauthAccountDomain(row);
}

export async function getOauthAccountByUser(
  database: Database,
  userId: string,
): Promise<OauthAccount | null> {
  const [row] = await database
    .select()
    .from(googleOauthAccounts)
    .where(eq(googleOauthAccounts.userId, userId))
    .limit(1);
  return row ? toOauthAccountDomain(row) : null;
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
      set: {
        summary: sql`excluded.summary`,
        timeZone: sql`excluded.time_zone`,
        isPrimary: sql`excluded.is_primary`,
        updatedAt: new Date(),
      },
    });
}

export async function listUserCalendars(
  database: Database,
  oauthAccountId: string,
): Promise<Calendar[]> {
  const rows = await database
    .select()
    .from(googleCalendars)
    .where(eq(googleCalendars.oauthAccountId, oauthAccountId));
  return rows.map(toCalendarDomain);
}

export async function findCalendarById(
  database: Database,
  calendarId: string,
): Promise<Calendar | null> {
  const [row] = await database
    .select()
    .from(googleCalendars)
    .where(eq(googleCalendars.id, calendarId))
    .limit(1);
  return row ? toCalendarDomain(row) : null;
}

export type CalendarFlagsPatch = {
  usedForBusy?: boolean;
  usedForWrites?: boolean;
};

/**
 * Plain single-row UPDATE for the flag columns. Does not enforce any
 * cross-row invariants (the "writes is exclusive within an account" rule
 * lives in usecase).
 */
export async function updateCalendarFlagsRow(
  database: Database,
  calendarId: string,
  patch: CalendarFlagsPatch,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.usedForBusy !== undefined) set.usedForBusy = patch.usedForBusy;
  if (patch.usedForWrites !== undefined) set.usedForWrites = patch.usedForWrites;
  await database.update(googleCalendars).set(set).where(eq(googleCalendars.id, calendarId));
}

/**
 * Clear `usedForWrites` on every calendar in the given oauth account
 * EXCEPT the one identified by `exceptCalendarId`. Used by the usecase
 * layer to keep "write target" exclusive within an account.
 */
export async function clearWritesFlagOnSiblings(
  database: Database,
  oauthAccountId: string,
  exceptCalendarId: string,
): Promise<void> {
  await database
    .update(googleCalendars)
    .set({ usedForWrites: false, updatedAt: new Date() })
    .where(
      and(
        eq(googleCalendars.oauthAccountId, oauthAccountId),
        sql`${googleCalendars.id} <> ${exceptCalendarId}`,
      ),
    );
}
