import { and, eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { availabilityExcludes, availabilityLinks, availabilityRules } from "@/db/schema/links";
import type { LinkInput, LinkUpdateInput } from "./schemas";

type Database = typeof DbClient;

export type LinkRow = typeof availabilityLinks.$inferSelect;
export type RuleRow = typeof availabilityRules.$inferSelect;
export type ExcludeRow = typeof availabilityExcludes.$inferSelect;

export type LinkWithRelations = LinkRow & {
  rules: Array<Pick<RuleRow, "weekday" | "startMinute" | "endMinute">>;
  excludes: string[];
};

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

export async function createLink(
  database: Database,
  userId: string,
  input: LinkInput,
): Promise<LinkWithRelations> {
  return database.transaction(async (tx) => {
    const [link] = await tx
      .insert(availabilityLinks)
      .values({
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
      })
      .returning();
    if (!link) throw new Error("failed to insert link");
    if (input.rules.length > 0) {
      await tx
        .insert(availabilityRules)
        .values(input.rules.map((r) => ({ ...r, linkId: link.id })));
    }
    if (input.excludes.length > 0) {
      await tx
        .insert(availabilityExcludes)
        .values(input.excludes.map((d) => ({ linkId: link.id, localDate: d })));
    }
    return { ...link, rules: input.rules, excludes: input.excludes };
  });
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
  return database.transaction(async (tx) => {
    const cols = linkColumnsForUpsert(patch);
    if (Object.keys(cols).length > 0) {
      const updated = await tx
        .update(availabilityLinks)
        .set({ ...cols, updatedAt: new Date() })
        .where(and(eq(availabilityLinks.id, linkId), eq(availabilityLinks.userId, userId)))
        .returning({ id: availabilityLinks.id });
      if (updated.length === 0) {
        return null;
      }
    } else {
      const [exists] = await tx
        .select({ id: availabilityLinks.id })
        .from(availabilityLinks)
        .where(and(eq(availabilityLinks.id, linkId), eq(availabilityLinks.userId, userId)))
        .limit(1);
      if (!exists) return null;
    }
    if (patch.rules !== undefined) {
      await tx.delete(availabilityRules).where(eq(availabilityRules.linkId, linkId));
      if (patch.rules.length > 0) {
        await tx.insert(availabilityRules).values(patch.rules.map((r) => ({ ...r, linkId })));
      }
    }
    if (patch.excludes !== undefined) {
      await tx.delete(availabilityExcludes).where(eq(availabilityExcludes.linkId, linkId));
      if (patch.excludes.length > 0) {
        await tx
          .insert(availabilityExcludes)
          .values(patch.excludes.map((d) => ({ linkId, localDate: d })));
      }
    }
    return getLinkForUser(tx as unknown as Database, userId, linkId);
  });
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

export async function isSlugTaken(database: Database, slug: string): Promise<boolean> {
  const [row] = await database
    .select({ id: availabilityLinks.id })
    .from(availabilityLinks)
    .where(eq(availabilityLinks.slug, slug))
    .limit(1);
  return Boolean(row);
}
