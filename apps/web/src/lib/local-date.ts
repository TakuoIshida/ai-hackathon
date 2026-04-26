function asDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Formats a date in YYYY-MM-DD as it appears in the given IANA timezone. */
export function formatLocalDate(date: Date | number | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asDate(date));
}

/** Formats time in 24h HH:mm in the given IANA timezone. */
export function formatLocalTime(date: Date | number | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(asDate(date));
}

/**
 * UTC milliseconds at the start of the given local calendar day (00:00 in `timeZone`).
 * Pure JavaScript implementation (no temporal/luxon).
 */
export function localDayStartMs(
  year: number,
  month1: number,
  day: number,
  timeZone: string,
): number {
  // Initial guess in UTC, then correct by the offset at that instant.
  const guess = Date.UTC(year, month1 - 1, day);
  const offset = getTzOffsetMs(guess, timeZone);
  const utc1 = guess - offset;
  // DST refinement
  const offset2 = getTzOffsetMs(utc1, timeZone);
  return guess - offset2;
}

function getTzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  let h = Number(map.hour);
  if (h === 24) h = 0;
  const local = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    h,
    Number(map.minute),
    Number(map.second),
  );
  return local - utcMs;
}

export type CalendarDay = { date: string; year: number; month: number; day: number };

/** Days that appear in a Sunday-anchored 6-week month grid. */
export function buildMonthGrid(year: number, month1: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const dayOfWeek = first.getUTCDay(); // 0 = Sun
  const gridStart = new Date(first.getTime() - dayOfWeek * 86400_000);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * 86400_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    days.push({
      year: y,
      month: m,
      day,
      date: `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }
  return days;
}
