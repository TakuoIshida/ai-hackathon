import type { availabilityExcludes, availabilityLinks, availabilityRules } from "@/db/schema/links";
import type { Weekday, WeeklyAvailability } from "@/scheduling";

export type LinkEntity = typeof availabilityLinks.$inferSelect;
export type RuleEntity = typeof availabilityRules.$inferSelect;
export type ExcludeEntity = typeof availabilityExcludes.$inferSelect;

export type LinkWithRelations = LinkEntity & {
  rules: Array<Pick<RuleEntity, "weekday" | "startMinute" | "endMinute">>;
  excludes: string[];
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
