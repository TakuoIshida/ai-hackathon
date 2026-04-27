import type { db as DbClient } from "@/db/client";
import { getOauthAccountByUser, listUserCalendars } from "@/google/repo";
import {
  type AvailabilityWindow,
  computeAvailableSlots,
  expandWeeklyAvailability,
  type Interval,
  type Slot,
} from "@/scheduling";
import { type Link, type LinkWithRelations, rulesToWeekly } from "./domain";
import {
  createLink,
  deleteLink,
  getLinkForUser,
  isSlugTaken,
  listLinkCoOwnerUserIds,
  listLinksForUser,
  setLinkCoOwners,
  updateLink,
} from "./repo";
import type { LinkInput, LinkUpdateInput } from "./schemas";

type Database = typeof DbClient;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Port for the Google-Calendar-side reads `computePublicSlots` needs to merge
 * a user's busy intervals into the public slot grid. The route layer assembles
 * a production adapter (refreshes access tokens, calls Calendar API); tests
 * inject a fake. Mirrors the `GoogleSinks` pattern in `bookings/confirm.ts`.
 */
export type GooglePort = {
  /**
   * Resolve a fresh, unexpired access token for a stored OAuth account row.
   * Throws if refresh fails — callers handle the throw.
   */
  getValidAccessToken: (oauthAccountId: string) => Promise<string>;
  /**
   * Free/busy lookup across the given calendar IDs in `[rangeStart, rangeEnd)`.
   * Returns an empty list when no calendars are passed.
   */
  getFreeBusy: (input: {
    accessToken: string;
    calendarIds: ReadonlyArray<string>;
    rangeStart: number;
    rangeEnd: number;
  }) => Promise<Interval[]>;
};

// ---------- CRUD use cases ----------

export type CreateLinkResult = { kind: "ok"; link: LinkWithRelations } | { kind: "slug_taken" };

export type UpdateLinkResult =
  | { kind: "ok"; link: LinkWithRelations }
  | { kind: "not_found" }
  | { kind: "slug_taken" };

export async function listLinks(database: Database, userId: string): Promise<Link[]> {
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

// ---------- ISH-112: co-owner management ----------

export type SetCoOwnersResult =
  | { kind: "ok"; coOwnerIds: string[] }
  | { kind: "not_found" }
  | { kind: "invalid"; reason: string };

/**
 * Replace the set of co-owners on a link. Only the link's primary owner
 * (link.userId) is allowed to call this. The primary is implicit and is
 * silently filtered out if included in the input set.
 */
export async function setCoOwnersForLink(
  database: Database,
  primaryUserId: string,
  linkId: string,
  userIds: ReadonlyArray<string>,
): Promise<SetCoOwnersResult> {
  // Reject obvious malformed input early.
  if (userIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return { kind: "invalid", reason: "user_id_must_be_non_empty_string" };
  }
  const link = await getLinkForUser(database, primaryUserId, linkId);
  if (!link) return { kind: "not_found" };
  await setLinkCoOwners(database, link, userIds);
  const coOwnerIds = await listLinkCoOwnerUserIds(database, link.id);
  return { kind: "ok", coOwnerIds };
}

export async function getCoOwnersForLink(
  database: Database,
  primaryUserId: string,
  linkId: string,
): Promise<{ kind: "ok"; coOwnerIds: string[] } | { kind: "not_found" }> {
  const link = await getLinkForUser(database, primaryUserId, linkId);
  if (!link) return { kind: "not_found" };
  return { kind: "ok", coOwnerIds: await listLinkCoOwnerUserIds(database, link.id) };
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

/**
 * Compute the slot grid for a public booking link.
 *
 * `google` is optional: when omitted (or when the user has no OAuth row), busy
 * intervals are skipped and the computation falls back to the link's
 * availability rules only. This is what production hits when GOOGLE_OAUTH_*
 * env vars are unset, and what tests pass to skip the SDK entirely.
 */
export async function computePublicSlots(
  database: Database,
  link: LinkWithRelations,
  params: PublicSlotsParams,
  google?: GooglePort,
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

  // ISH-112: merge busy across all owners (primary + co-owners).
  // Per-owner failures are logged and skipped — the slot grid stays usable
  // even if one owner's Google connection is broken.
  const coOwnerIds = await listLinkCoOwnerUserIds(database, link.id);
  const ownerIds = [link.userId, ...coOwnerIds];

  const busy: Interval[] = [];
  if (google) {
    for (const ownerId of ownerIds) {
      const account = await getOauthAccountByUser(database, ownerId);
      if (!account) continue;
      try {
        const accessToken = await google.getValidAccessToken(account.id);
        const calendars = await listUserCalendars(database, account.id);
        const calendarIds = calendars.filter((c) => c.usedForBusy).map((c) => c.googleCalendarId);
        const fb = await google.getFreeBusy({ accessToken, calendarIds, rangeStart, rangeEnd });
        busy.push(...fb);
      } catch (err) {
        console.warn(
          `[public-slots] busy fetch failed for owner=${ownerId}; skipping that owner:`,
          err,
        );
      }
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
