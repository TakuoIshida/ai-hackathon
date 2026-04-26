import type { db as DbClient } from "@/db/client";
import {
  type CalendarFlagsPatch,
  type CalendarRow,
  findCalendarById,
  getOauthAccountByUser,
  updateCalendarFlags as updateCalendarFlagsRepo,
} from "./repo";

type Database = typeof DbClient;

export type UpdateCalendarFlagsResult =
  | { kind: "ok"; calendar: CalendarRow }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "invalid"; reason: string };

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

  const updated = await updateCalendarFlagsRepo(database, cal, patch);
  if (!updated) return { kind: "not_found" };
  return { kind: "ok", calendar: updated };
}
