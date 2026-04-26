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
} from "@/scheduling";
import { type LinkWithRelations, rulesToWeekly } from "./domain";
import {
  createLink,
  deleteLink,
  getLinkForUser,
  isSlugTaken,
  type LinkRow,
  listLinksForUser,
  updateLink,
} from "./repo";
import type { LinkInput, LinkUpdateInput } from "./schemas";

type Database = typeof DbClient;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------- CRUD use cases ----------

export type CreateLinkResult = { kind: "ok"; link: LinkWithRelations } | { kind: "slug_taken" };

export type UpdateLinkResult =
  | { kind: "ok"; link: LinkWithRelations }
  | { kind: "not_found" }
  | { kind: "slug_taken" };

export async function listLinks(database: Database, userId: string): Promise<LinkRow[]> {
  return listLinksForUser(database, userId);
}

export async function getLink(
  database: Database,
  userId: string,
  linkId: string,
): Promise<LinkWithRelations | null> {
  return getLinkForUser(database, userId, linkId);
}

export async function checkSlugAvailability(
  database: Database,
  slug: string,
): Promise<{ slug: string; available: boolean }> {
  const taken = await isSlugTaken(database, slug);
  return { slug, available: !taken };
}

export async function createLinkForUser(
  database: Database,
  userId: string,
  input: LinkInput,
): Promise<CreateLinkResult> {
  if (await isSlugTaken(database, input.slug)) {
    return { kind: "slug_taken" };
  }
  const link = await createLink(database, userId, input);
  return { kind: "ok", link };
}

export async function updateLinkForUser(
  database: Database,
  userId: string,
  linkId: string,
  patch: LinkUpdateInput,
): Promise<UpdateLinkResult> {
  if (patch.slug !== undefined) {
    const existing = await getLinkForUser(database, userId, linkId);
    if (!existing) return { kind: "not_found" };
    if (existing.slug !== patch.slug && (await isSlugTaken(database, patch.slug))) {
      return { kind: "slug_taken" };
    }
  }
  const updated = await updateLink(database, userId, linkId, patch);
  if (!updated) return { kind: "not_found" };
  return { kind: "ok", link: updated };
}

export async function deleteLinkForUser(
  database: Database,
  userId: string,
  linkId: string,
): Promise<boolean> {
  return deleteLink(database, userId, linkId);
}

// ---------- Public read use case (slots) ----------

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
