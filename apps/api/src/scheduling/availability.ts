import { clamp } from "./intervals";
import { formatLocalDate, localPartsOf, localToUtcMs, nextLocalDay } from "./timezone";
import type { AvailabilityWindow, ExpandWeeklyInput, Weekday } from "./types";

export function expandWeeklyAvailability(input: ExpandWeeklyInput): AvailabilityWindow[] {
  const { timeZone, weekly, rangeStart, rangeEnd, excludeLocalDates } = input;
  if (rangeStart >= rangeEnd) return [];

  const exclude = new Set(excludeLocalDates ?? []);
  const result: AvailabilityWindow[] = [];

  const startLocal = localPartsOf(rangeStart, timeZone);
  const endLocal = localPartsOf(rangeEnd, timeZone);

  let { year, month, day } = startLocal;
  const endKey = formatLocalDate(endLocal.year, endLocal.month, endLocal.day);

  while (true) {
    const localDate = formatLocalDate(year, month, day);
    if (!exclude.has(localDate)) {
      const dayStartUtc = localToUtcMs(year, month, day, 0, 0, timeZone);
      const weekday = localPartsOf(dayStartUtc, timeZone).weekday as Weekday;
      const todWindows = weekly[weekday] ?? [];

      for (const w of todWindows) {
        if (w.endMinute <= w.startMinute) continue;

        const startUtc = localToUtcMs(
          year,
          month,
          day,
          Math.floor(w.startMinute / 60),
          w.startMinute % 60,
          timeZone,
        );

        let endUtc: number;
        if (w.endMinute === 24 * 60) {
          const n = nextLocalDay(year, month, day);
          endUtc = localToUtcMs(n.year, n.month, n.day, 0, 0, timeZone);
        } else {
          endUtc = localToUtcMs(
            year,
            month,
            day,
            Math.floor(w.endMinute / 60),
            w.endMinute % 60,
            timeZone,
          );
        }

        const clamped = clamp(
          { start: startUtc, end: endUtc },
          { start: rangeStart, end: rangeEnd },
        );
        if (clamped) {
          result.push({ start: clamped.start, end: clamped.end, localDate });
        }
      }
    }

    if (localDate === endKey) break;
    const next = nextLocalDay(year, month, day);
    year = next.year;
    month = next.month;
    day = next.day;
  }

  return result;
}
