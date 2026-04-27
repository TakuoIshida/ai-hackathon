import type { Weekday, WeeklyAvailability } from "@/scheduling";

/**
 * Pure-domain availability link. The shape mirrors the on-disk row only
 * because the persistence schema happens to fit the domain — `repo.ts`
 * still owns the row→domain mapping (`toLinkDomain`) so a future schema
 * change does not silently propagate into usecase / route layers.
 *
 * Intentionally avoids importing from `drizzle-orm` or `@/db/schema/*` so
 * `apps/api/src/links/domain.ts` has zero dependency on the ORM (ISH-120).
 */
export type Link = {
  id: string;
  userId: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number | null;
  maxPerDay: number | null;
  leadTimeHours: number;
  rangeDays: number;
  timeZone: string;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LinkRule = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type LinkWithRelations = Link & {
  rules: ReadonlyArray<LinkRule>;
  excludes: ReadonlyArray<string>;
};

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
