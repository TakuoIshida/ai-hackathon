import type { db as DbClient } from "@/db/client";
import { getValidAccessToken } from "@/google/access-token";
import { queryFreeBusy } from "@/google/calendar";
import { loadGoogleConfig } from "@/google/config";
import { getOauthAccountByUser, listUserCalendars } from "@/google/repo";
import {
  type AvailabilityWindow,
  computeAvailableSlots,
  expandWeeklyAvailability,
  type Interval,
  type Slot,
  type Weekday,
  type WeeklyAvailability,
} from "@/scheduling";
import type { LinkWithRelations } from "./repo";

type Database = typeof DbClient;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function rulesToWeekly(
  rules: ReadonlyArray<{ weekday: number; startMinute: number; endMinute: number }>,
): WeeklyAvailability {
  const weekly: WeeklyAvailability = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const r of rules) {
    if (r.weekday < 0 || r.weekday > 6) continue;
    weekly[r.weekday as Weekday].push({
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    });
  }
  return weekly;
}

export type PublicSlotsParams = {
  fromMs: number;
  toMs: number;
  nowMs?: number;
};

export type PublicSlotsResult = {
  windows: AvailabilityWindow[];
  busy: Interval[];
  slots: Slot[];
  effectiveRange: Interval | null;
};

export async function computePublicSlots(
  database: Database,
  link: LinkWithRelations,
  params: PublicSlotsParams,
): Promise<PublicSlotsResult> {
  const now = params.nowMs ?? Date.now();
  const leadEnd = now + link.leadTimeHours * HOUR_MS;
  const horizonEnd = now + link.rangeDays * DAY_MS;
  const rangeStart = Math.max(params.fromMs, leadEnd);
  const rangeEnd = Math.min(params.toMs, horizonEnd);
  if (rangeStart >= rangeEnd) {
    return { windows: [], busy: [], slots: [], effectiveRange: null };
  }

  const weekly = rulesToWeekly(link.rules);
  const windows = expandWeeklyAvailability({
    timeZone: link.timeZone,
    weekly,
    rangeStart,
    rangeEnd,
    excludeLocalDates: link.excludes,
  });

  let busy: Interval[] = [];
  const account = await getOauthAccountByUser(database, link.userId);
  if (account) {
    try {
      const cfg = loadGoogleConfig();
      const accessToken = await getValidAccessToken(database, cfg, account.id);
      const calendars = await listUserCalendars(database, account.id);
      const calendarIds = calendars.filter((c) => c.usedForBusy).map((c) => c.googleCalendarId);
      busy = await queryFreeBusy({ accessToken, calendarIds, rangeStart, rangeEnd });
    } catch (err) {
      console.warn("[public-slots] busy fetch failed; returning windows without busy:", err);
    }
  }

  const slots = computeAvailableSlots({
    rangeStart,
    rangeEnd,
    windows,
    busy,
    durationMinutes: link.durationMinutes,
    bufferBeforeMinutes: link.bufferBeforeMinutes,
    bufferAfterMinutes: link.bufferAfterMinutes,
    slotIntervalMinutes: link.slotIntervalMinutes ?? undefined,
    maxPerDay: link.maxPerDay ?? undefined,
  });

  return {
    windows,
    busy,
    slots,
    effectiveRange: { start: rangeStart, end: rangeEnd },
  };
}
