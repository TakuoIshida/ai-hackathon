import { ulid } from "ulidx";
import type { db as DbClient } from "@/db/client";
import type { GooglePort, PublicSlotsParams, PublicSlotsResult } from "@/ports";
import { computeAvailableSlots, expandWeeklyAvailability, type Interval } from "@/scheduling";
import {
  type CreateLinkCommand,
  type Link,
  type LinkWithRelations,
  rulesToWeekly,
  type UpdateLinkCommand,
} from "./domain";
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

export type { PublicSlotsParams, PublicSlotsResult } from "@/ports";

type Database = typeof DbClient;

const DAY_MS = 24 * 3600 * 1000;

// ---------- CRUD use cases ----------

export type CreateLinkResult = { kind: "ok"; link: LinkWithRelations } | { kind: "slug_taken" };

export type UpdateLinkResult =
  | { kind: "ok"; link: LinkWithRelations }
  | { kind: "not_found" }
  | { kind: "slug_taken" };

/**
 * Slugs that collide with FE app routes (ISH-227). The FE uses flat URLs at
 * the root (/availability-sharings, /calendar, ...) and a catch-all `/:slug`
 * for public booking pages. To prevent a public link from shadowing an app
 * route, we reject these names at create / update / availability-check time.
 *
 * Keep this list in sync with `apps/web/src/App.tsx` whenever a new
 * authenticated top-level route is introduced.
 */
const RESERVED_SLUGS = new Set<string>([
  // Authenticated app tabs
  "availability-sharings",
  "calendar",
  "unconfirmed-list",
  "confirmed-list",
  "forms",
  "settings",
  // Auth flow + onboarding
  "sign-in",
  "sign-up",
  "onboarding",
  // Public flow
  "cancel",
  "invite",
  "invitations",
  // Internal
  "dev",
  "dashboard",
  "api",
  "health",
  "webhooks",
  "public",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

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
  if (isReservedSlug(slug)) {
    return { slug, available: false };
  }
  const taken = await isSlugTaken(database, slug);
  return { slug, available: !taken };
}

/**
 * ISH-296 (B): Generate a short, URL-safe slug from a fresh ULID. ULID is
 * Crockford base32 (already lowercase-friendly) — we lowercase it and take the
 * last 8 chars (most random portion) so the slug is short but the keyspace
 * (32^8 ≈ 1.1e12) makes accidental collisions effectively impossible across
 * a single tenant. Reserved slugs are filtered explicitly.
 */
function generateRandomSlug(): string {
  // ulid() → 26 chars Crockford base32, mostly uppercase. Lowercase and take
  // the random tail to avoid the timestamp-prefixed first 10 chars (which
  // would produce visually adjacent slugs for adjacent inserts).
  return ulid().toLowerCase().slice(-8);
}

const SLUG_GEN_MAX_RETRIES = 5;

export async function createLinkForUser(
  database: Database,
  userId: string,
  tenantId: string,
  input: CreateLinkCommand,
): Promise<CreateLinkResult> {
  let slug: string;
  if (input.slug !== undefined) {
    if (isReservedSlug(input.slug) || (await isSlugTaken(database, input.slug))) {
      return { kind: "slug_taken" };
    }
    slug = input.slug;
  } else {
    // Auto-generate. Retry on collision with the reserved set or DB. Cap the
    // loop so a buggy environment can't wedge us into an infinite retry.
    let candidate: string | null = null;
    for (let attempt = 0; attempt < SLUG_GEN_MAX_RETRIES; attempt++) {
      const next = generateRandomSlug();
      if (isReservedSlug(next)) continue;
      // eslint-disable-next-line no-await-in-loop -- sequential by design (retry)
      if (await isSlugTaken(database, next)) continue;
      candidate = next;
      break;
    }
    if (candidate === null) {
      // Astronomically unlikely (32^8 keyspace); surface as the same kind so
      // callers can treat it like a transient slug-taken error.
      return { kind: "slug_taken" };
    }
    slug = candidate;
  }
  const link = await createLink(database, userId, tenantId, { ...input, slug });
  return { kind: "ok", link };
}

export async function updateLinkForUser(
  database: Database,
  userId: string,
  linkId: string,
  patch: UpdateLinkCommand,
): Promise<UpdateLinkResult> {
  if (patch.slug !== undefined) {
    const existing = await getLinkForUser(database, userId, linkId);
    if (!existing) return { kind: "not_found" };
    if (existing.slug !== patch.slug) {
      if (isReservedSlug(patch.slug) || (await isSlugTaken(database, patch.slug))) {
        return { kind: "slug_taken" };
      }
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

/**
 * Compute the slot grid for a public booking link.
 *
 * `google` is optional: when omitted/null (or when the user has no OAuth row),
 * busy intervals are skipped and the computation falls back to the link's
 * availability rules only. This is what production hits when GOOGLE_OAUTH_*
 * env vars are unset, and what tests pass to skip the SDK entirely.
 */
export async function computePublicSlots(
  database: Database,
  link: LinkWithRelations,
  params: PublicSlotsParams,
  google?: GooglePort | null,
): Promise<PublicSlotsResult> {
  const now = params.nowMs ?? Date.now();
  const horizonEnd = now + link.rangeDays * DAY_MS;
  const rangeStart = Math.max(params.fromMs, now);
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
  });

  // ISH-112: merge busy across all owners (primary + co-owners). The co-owner
  // lookup and per-owner Google fetches are gated on `google` being present —
  // production's booking-confirm revalidation passes `google=null` (see
  // routes/public.ts) and skips all of this. ISH-152: per-owner work runs in
  // parallel via allSettled; failures stay scoped to that owner so the slot
  // grid remains usable when one Google connection is broken.
  const busy: Interval[] = [];
  if (google) {
    const coOwnerIds = await listLinkCoOwnerUserIds(database, link.id);
    const ownerIds = [link.userId, ...coOwnerIds];
    const settled = await Promise.allSettled(
      ownerIds.map(async (ownerId) => {
        const account = await google.getOauthAccountByUser(ownerId);
        if (!account) return { ownerId, busy: [] as Interval[] };
        const [accessToken, calendars] = await Promise.all([
          google.getValidAccessToken(account.id),
          google.listUserCalendars(account.id),
        ]);
        const calendarIds = calendars.filter((c) => c.usedForBusy).map((c) => c.googleCalendarId);
        const fb = await google.getFreeBusy({ accessToken, calendarIds, rangeStart, rangeEnd });
        return { ownerId, busy: [...fb] };
      }),
    );
    for (const [i, r] of settled.entries()) {
      if (r.status === "fulfilled") {
        busy.push(...r.value.busy);
      } else {
        console.warn(
          `[public-slots] busy fetch failed for owner=${ownerIds[i]}; skipping that owner:`,
          r.reason,
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
  });

  return {
    windows,
    busy,
    slots,
    effectiveRange: { start: rangeStart, end: rangeEnd },
  };
}
