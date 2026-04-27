import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import {
  availabilityExcludes,
  availabilityLinks,
  availabilityRules,
  linkOwners,
} from "@/db/schema/links";
import type { ExcludeEntity, LinkEntity, LinkWithRelations, RuleEntity } from "./domain";
import type { LinkInput, LinkUpdateInput } from "./schemas";

type Database = typeof DbClient;

// Backwards-compatible aliases for existing imports.
export type LinkRow = LinkEntity;
export type RuleRow = RuleEntity;
export type ExcludeRow = ExcludeEntity;
export type { LinkWithRelations };

const linkColumnsForUpsert = (input: Partial<LinkInput>) => {
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
): Promise<{ rules: LinkWithRelations["rules"]; excludes: string[] }> {
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
  input: LinkInput,
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

export async function listLinksForUser(database: Database, userId: string): Promise<LinkRow[]> {
  return database.select().from(availabilityLinks).where(eq(availabilityLinks.userId, userId));
}

export async function getLinkForUser(
  database: Database,
  userId: string,
  linkId: string,
): Promise<LinkWithRelations | null> {
  const [link] = await database
    .select()
    .from(availabilityLinks)
    .where(and(eq(availabilityLinks.id, linkId), eq(availabilityLinks.userId, userId)))
    .limit(1);
  if (!link) return null;
  const relations = await loadRelations(database, link.id);
  return { ...link, ...relations };
}

export async function updateLink(
  database: Database,
  userId: string,
  linkId: string,
  patch: LinkUpdateInput,
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

export async function findPublishedLinkBySlug(
  database: Database,
  slug: string,
): Promise<LinkWithRelations | null> {
  const [link] = await database
    .select()
    .from(availabilityLinks)
    .where(and(eq(availabilityLinks.slug, slug), eq(availabilityLinks.isPublished, true)))
    .limit(1);
  if (!link) return null;
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
  link: Pick<LinkEntity, "id" | "userId">,
  userIds: ReadonlyArray<string>,
): Promise<void> {
  type BatchQuery = Parameters<Database["batch"]>[0][number];
  const filtered = Array.from(new Set(userIds)).filter((u) => u !== link.userId);
  const queries: BatchQuery[] = [database.delete(linkOwners).where(eq(linkOwners.linkId, link.id))];
  if (filtered.length > 0) {
    queries.push(
      database.insert(linkOwners).values(filtered.map((userId) => ({ linkId: link.id, userId }))),
    );
  }
  await database.batch(queries as [BatchQuery, ...BatchQuery[]]);
}
