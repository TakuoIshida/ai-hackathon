import type { Weekday } from "./types";

export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
};

const WEEKDAY_MAP: Record<string, Weekday> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export function localPartsOf(utcMs: number, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const map: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_MAP[map.weekday ?? "Sun"] ?? 0,
  };
}

function getOffsetMs(utcMs: number, timeZone: string): number {
  const lp = localPartsOf(utcMs, timeZone);
  const localAsUtc = Date.UTC(lp.year, lp.month - 1, lp.day, lp.hour, lp.minute, lp.second);
  return localAsUtc - utcMs;
}

export function localToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = getOffsetMs(guess, timeZone);
  const utc1 = guess - off1;
  const off2 = getOffsetMs(utc1, timeZone);
  return guess - off2;
}

export function formatLocalDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function nextLocalDay(
  year: number,
  month: number,
  day: number,
): {
  year: number;
  month: number;
  day: number;
} {
  const utc = Date.UTC(year, month - 1, day) + 24 * 60 * 60 * 1000;
  const d = new Date(utc);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
