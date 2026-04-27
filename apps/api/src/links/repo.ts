import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import {
  type AvailabilityLink,
  availabilityExcludes,
  availabilityLinks,
  availabilityRules,
  linkOwners,
} from "@/db/schema/links";
import type {
  CreateLinkCommand,
  Link,
  LinkRule,
  LinkWithRelations,
  UpdateLinkCommand,
} from "./domain";

type Database = typeof DbClient;

/**
 * Row → domain mapper. The `Link` domain type is structurally identical to
 * the DB row today, but routing every read through this function keeps a
 * single chokepoint for future divergence (ex. computed fields, encrypted
 * columns, type-tagged ids).
 */
function toLinkDomain(row: AvailabilityLink): Link {
  return {
    id: row.id,
    userId: row.userId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    durationMinutes: row.durationMinutes,
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    slotIntervalMinutes: row.slotIntervalMinutes,
    maxPerDay: row.maxPerDay,
    leadTimeHours: row.leadTimeHours,
    rangeDays: row.rangeDays,
    timeZone: row.timeZone,
    isPublished: row.isPublished,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const linkColumnsForUpsert = (input: Partial<CreateLinkCommand>) => {
  const out: Record<string, unknown> = {};
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.title !== undefined) out.title = input.title;
  if (input.description !== undefined) out.description = input.description;
  if (input.durationMinutes !== undefined) out.durationMinutes = input.durationMinutes;
  if (input.bufferBeforeMinutes !== undefined) out.bufferBeforeMinutes = input.bufferBeforeMinutes;
  if (input.bufferAfterMinutes !== undefined) out.bufferAfterMinutes = input.bufferAfterMinutes;
  if (input.slotIntervalMinutes !== undefined) out.slotIntervalMinutes = input.slotIntervalMinutes;
  if (input.maxPerDay !== undefined) out.maxPerDay = input.maxPerDay;
  if (input.leadTimeHours !== undefined) out.leadTimeHours = input.leadTimeHours;
  if (input.rangeDays !== undefined) out.rangeDays = input.rangeDays;
  if (input.timeZone !== undefined) out.timeZone = input.timeZone;
  if (input.isPublished !== undefined) out.isPublished = input.isPublished;
  return out;
};

async function loadRelations(
  database: Database,
  linkId: string,
): Promise<{ rules: LinkRule[]; excludes: string[] }> {
  const rules = await database
    .select({
      weekday: availabilityRules.weekday,
      startMinute: availabilityRules.startMinute,
      endMinute: availabilityRules.endMinute,
    })
    .from(availabilityRules)
    .where(eq(availabilityRules.linkId, linkId));
  const excludes = await database
    .select({ localDate: availabilityExcludes.localDate })
    .from(availabilityExcludes)
    .where(eq(availabilityExcludes.linkId, linkId));
  return { rules, excludes: excludes.map((e) => e.localDate) };
}

// neon-http does not support callback transactions, so we use db.batch (atomic, single HTTP req).
type BatchQuery = Parameters<Database["batch"]>[0][number];

export async function createLink(
  database: Database,
  userId: string,
  input: CreateLinkCommand,
): Promise<LinkWithRelations> {
  const linkId = randomUUID();
  const queries: BatchQuery[] = [
    database.insert(availabilityLinks).values({
      id: linkId,
      userId,
      slug: input.slug,
      title: input.title,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      bufferBeforeMinutes: input.bufferBeforeMinutes,
      bufferAfterMinutes: input.bufferAfterMinutes,
      slotIntervalMinutes: input.slotIntervalMinutes ?? null,
      maxPerDay: input.maxPerDay ?? null,
      leadTimeHours: input.leadTimeHours,
      rangeDays: input.rangeDays,
      timeZone: input.timeZone,
      isPublished: input.isPublished,
    }),
  ];
  if (input.rules.length > 0) {
    queries.push(
      database.insert(availabilityRules).values(input.rules.map((r) => ({ ...r, linkId }))),
    );
  }
  if (input.excludes.length > 0) {
    queries.push(
      database
        .insert(availabilityExcludes)
        .values(input.excludes.map((d) => ({ linkId, localDate: d }))),
    );
  }
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);

  const reloaded = await getLinkForUser(database, userId, linkId);
  if (!reloaded) throw new Error("link disappeared after insert");
  return reloaded;
}

export async function listLinksForUser(database: Database, userId: string): Promise<Link[]> {
  const rows = await database
    .select()
    .from(availabilityLinks)
    .where(eq(availabilityLinks.userId, userId));
  return rows.map(toLinkDomain);
}

export async function getLinkForUser(
  database: Database,
  userId: string,
  linkId: string,
): Promise<LinkWithRelations | null> {
  const [row] = await database
    .select()
    .from(availabilityLinks)
    .where(and(eq(availabilityLinks.id, linkId), eq(availabilityLinks.userId, userId)))
    .limit(1);
  if (!row) return null;
  const link = toLinkDomain(row);
  const relations = await loadRelations(database, link.id);
  return { ...link, ...relations };
}

export async function updateLink(
  database: Database,
  userId: string,
  linkId: string,
  patch: UpdateLinkCommand,
): Promise<LinkWithRelations | null> {
  // Existence + ownership check happens outside the batch — neon-http cannot
  // return rows from a write inside a multi-statement HTTP transaction.
  const existing = await getLinkForUser(database, userId, linkId);
  if (!existing) return null;

  const queries: BatchQuery[] = [];
  const cols = linkColumnsForUpsert(patch);
  if (Object.keys(cols).length > 0) {
    queries.push(
      database
        .update(availabilityLinks)
        .set({ ...cols, updatedAt: new Date() })
        .where(and(eq(availabilityLinks.id, linkId), eq(availabilityLinks.userId, userId))),
    );
  }
  if (patch.rules !== undefined) {
    queries.push(database.delete(availabilityRules).where(eq(availabilityRules.linkId, linkId)));
    if (patch.rules.length > 0) {
      queries.push(
        database.insert(availabilityRules).values(patch.rules.map((r) => ({ ...r, linkId }))),
      );
    }
  }
  if (patch.excludes !== undefined) {
    queries.push(
      database.delete(availabilityExcludes).where(eq(availabilityExcludes.linkId, linkId)),
    );
    if (patch.excludes.length > 0) {
      queries.push(
        database
          .insert(availabilityExcludes)
          .values(patch.excludes.map((d) => ({ linkId, localDate: d }))),
      );
    }
  }

  if (queries.length > 0) {
    await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
  }

  return getLinkForUser(database, userId, linkId);
}

export async function deleteLink(
  database: Database,
  userId: string,
  linkId: string,
): Promise<boolean> {
  const result = await database
    .delete(availabilityLinks)
    .where(and(eq(availabilityLinks.id, linkId), eq(availabilityLinks.userId, userId)))
    .returning({ id: availabilityLinks.id });
  return result.length > 0;
}

/**
 * Plain row by id (no rules/excludes, no ownership scoping). Used by
 * cross-feature lookups via `LinkLookupPort` — bookings cancel needs the
 * link's owner / title to build notifications without caring about who is
 * cancelling.
 */
export async function findLinkById(database: Database, linkId: string): Promise<Link | null> {
  const [row] = await database
    .select()
    .from(availabilityLinks)
    .where(eq(availabilityLinks.id, linkId))
    .limit(1);
  return row ? toLinkDomain(row) : null;
}

export async function findPublishedLinkBySlug(
  database: Database,
  slug: string,
): Promise<LinkWithRelations | null> {
  const [row] = await database
    .select()
    .from(availabilityLinks)
    .where(and(eq(availabilityLinks.slug, slug), eq(availabilityLinks.isPublished, true)))
    .limit(1);
  if (!row) return null;
  const link = toLinkDomain(row);
  const relations = await loadRelations(database, link.id);
  return { ...link, ...relations };
}

export async function isSlugTaken(database: Database, slug: string): Promise<boolean> {
  const [row] = await database
    .select({ id: availabilityLinks.id })
    .from(availabilityLinks)
    .where(eq(availabilityLinks.slug, slug))
    .limit(1);
  return Boolean(row);
}

// ---------- ISH-112: link co-owners ----------

/**
 * Co-owner user IDs for a link. The primary owner (link.userId) is implicit
 * and is NOT returned here.
 */
export async function listLinkCoOwnerUserIds(
  database: Database,
  linkId: string,
): Promise<string[]> {
  const rows = await database
    .select({ userId: linkOwners.userId })
    .from(linkOwners)
    .where(eq(linkOwners.linkId, linkId));
  return rows.map((r) => r.userId);
}

/**
 * Replace the co-owner set for a link. Idempotent. The primary owner is
 * never inserted here even if passed in (callers may pass the full
 * "all owners" set without filtering).
 */
export async function setLinkCoOwners(
  database: Database,
  link: Pick<Link, "id" | "userId">,
  userIds: ReadonlyArray<string>,
): Promise<void> {
  const filtered = Array.from(new Set(userIds)).filter((u) => u !== link.userId);
  const queries: BatchQuery[] = [database.delete(linkOwners).where(eq(linkOwners.linkId, link.id))];
  if (filtered.length > 0) {
    queries.push(
      database.insert(linkOwners).values(filtered.map((userId) => ({ linkId: link.id, userId }))),
    );
  }
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
}
