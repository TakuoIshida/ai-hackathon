import { describe, expect, test } from "bun:test";
import { formatLocalDate, localPartsOf, localToUtcMs, nextLocalDay } from "./timezone";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("localToUtcMs — America/Los_Angeles spring-forward (2026-03-08)", () => {
  // On 2026-03-08 in LA, 02:00 PST (UTC-8) jumps forward to 03:00 PDT (UTC-7).
  // Local times in [02:00, 03:00) do not exist. The implementation resolves
  // these by applying the post-jump (PDT) offset, which is consistent with
  // how it resolves any other PDT instant.
  const LA = "America/Los_Angeles";

  test("midnight before the gap uses PST (UTC-8)", () => {
    // 2026-03-08 00:00 PST = 2026-03-08 08:00 UTC
    expect(localToUtcMs(2026, 3, 8, 0, 0, LA)).toBe(Date.UTC(2026, 2, 8, 8, 0));
  });

  test("01:30 (just before the gap) uses PST (UTC-8)", () => {
    // 2026-03-08 01:30 PST = 2026-03-08 09:30 UTC
    expect(localToUtcMs(2026, 3, 8, 1, 30, LA)).toBe(Date.UTC(2026, 2, 8, 9, 30));
  });

  test("02:00 (gap start, non-existent) resolves to 09:00 UTC", () => {
    // Implementation resolves 02:00 to the same UTC as 03:00 PDT
    // 03:00 PDT = 10:00 UTC, so 02:00 (non-existent) collapses to 09:00 UTC
    // (treated as 02:00 PDT under the post-jump offset).
    expect(localToUtcMs(2026, 3, 8, 2, 0, LA)).toBe(Date.UTC(2026, 2, 8, 9, 0));
  });

  test("02:30 (inside the gap, non-existent) maps to 02:30 PDT", () => {
    // 02:30 PDT = 09:30 UTC. This is the same UTC instant as 01:30 PST,
    // i.e. the gap collapses with the prior PST hour.
    expect(localToUtcMs(2026, 3, 8, 2, 30, LA)).toBe(Date.UTC(2026, 2, 8, 9, 30));
  });

  test("03:00 (after the gap) uses PDT (UTC-7)", () => {
    // 2026-03-08 03:00 PDT = 2026-03-08 10:00 UTC
    expect(localToUtcMs(2026, 3, 8, 3, 0, LA)).toBe(Date.UTC(2026, 2, 8, 10, 0));
  });

  test("the spring-forward day is 23 hours long", () => {
    const dayStart = localToUtcMs(2026, 3, 8, 0, 0, LA);
    const nextDayStart = localToUtcMs(2026, 3, 9, 0, 0, LA);
    expect(nextDayStart - dayStart).toBe(23 * HOUR);
  });
});

describe("localToUtcMs — America/Los_Angeles fall-back (2026-11-01)", () => {
  // On 2026-11-01, 02:00 PDT (UTC-7) falls back to 01:00 PST (UTC-8).
  // Local times in [01:00, 02:00) occur twice. The current implementation
  // resolves ambiguous times to the FIRST occurrence (PDT, UTC-7) because
  // getOffsetMs is iterated only once after the initial guess.
  const LA = "America/Los_Angeles";

  test("00:00 uses PDT (UTC-7)", () => {
    // 2026-11-01 00:00 PDT = 2026-11-01 07:00 UTC
    expect(localToUtcMs(2026, 11, 1, 0, 0, LA)).toBe(Date.UTC(2026, 10, 1, 7, 0));
  });

  test("01:00 (start of ambiguous window) maps to first occurrence (PDT)", () => {
    // First 01:00 PDT = 08:00 UTC; second 01:00 PST = 09:00 UTC.
    // Implementation picks first.
    expect(localToUtcMs(2026, 11, 1, 1, 0, LA)).toBe(Date.UTC(2026, 10, 1, 8, 0));
  });

  test("01:30 (ambiguous) maps to first occurrence (PDT, UTC-7)", () => {
    // First 01:30 PDT = 08:30 UTC; second 01:30 PST = 09:30 UTC.
    // Pinned: implementation returns the first (PDT) occurrence.
    expect(localToUtcMs(2026, 11, 1, 1, 30, LA)).toBe(Date.UTC(2026, 10, 1, 8, 30));
  });

  test("02:00 (after fall-back, unambiguous) uses PST (UTC-8)", () => {
    // 2026-11-01 02:00 PST = 2026-11-01 10:00 UTC
    expect(localToUtcMs(2026, 11, 1, 2, 0, LA)).toBe(Date.UTC(2026, 10, 1, 10, 0));
  });

  test("the fall-back day is 25 hours long", () => {
    const dayStart = localToUtcMs(2026, 11, 1, 0, 0, LA);
    const nextDayStart = localToUtcMs(2026, 11, 2, 0, 0, LA);
    expect(nextDayStart - dayStart).toBe(25 * HOUR);
  });
});

describe("localToUtcMs — non-integer offsets", () => {
  test("Pacific/Chatham winter (UTC+12:45)", () => {
    // 2026-07-15 12:00 NZST (Chatham winter, +12:45)
    // = 2026-07-14 23:15 UTC
    const CH = "Pacific/Chatham";
    expect(localToUtcMs(2026, 7, 15, 12, 0, CH)).toBe(Date.UTC(2026, 6, 14, 23, 15));
  });

  test("Pacific/Chatham summer (UTC+13:45)", () => {
    // 2026-01-15 12:00 NZDT (Chatham summer, +13:45)
    // = 2026-01-14 22:15 UTC
    const CH = "Pacific/Chatham";
    expect(localToUtcMs(2026, 1, 15, 12, 0, CH)).toBe(Date.UTC(2026, 0, 14, 22, 15));
  });

  test("Pacific/Chatham midnight winter is offset by 12:45", () => {
    const CH = "Pacific/Chatham";
    // 2026-07-15 00:00 local = 2026-07-14 11:15 UTC
    expect(localToUtcMs(2026, 7, 15, 0, 0, CH)).toBe(Date.UTC(2026, 6, 14, 11, 15));
  });

  test("Asia/Kolkata midnight (UTC+5:30) crosses into prior UTC date", () => {
    const IN = "Asia/Kolkata";
    // 2026-04-26 00:00 IST = 2026-04-25 18:30 UTC
    expect(localToUtcMs(2026, 4, 26, 0, 0, IN)).toBe(Date.UTC(2026, 3, 25, 18, 30));
  });

  test("Asia/Kolkata 09:30 IST = 04:00 UTC same date", () => {
    const IN = "Asia/Kolkata";
    expect(localToUtcMs(2026, 4, 26, 9, 30, IN)).toBe(Date.UTC(2026, 3, 26, 4, 0));
  });

  test("Asia/Kolkata 23:30 IST = 18:00 UTC same date", () => {
    const IN = "Asia/Kolkata";
    expect(localToUtcMs(2026, 4, 26, 23, 30, IN)).toBe(Date.UTC(2026, 3, 26, 18, 0));
  });
});

describe("midnight / 24:00 boundary handling", () => {
  test("nextLocalDay anchors midnight = next-day 00:00 (no DST)", () => {
    const next = nextLocalDay(2026, 4, 26);
    expect(next).toEqual({ year: 2026, month: 4, day: 27 });
    // localToUtcMs of next-day 00:00 should be exactly 24h after current 00:00 in UTC TZ
    const tz = "UTC";
    const a = localToUtcMs(2026, 4, 26, 0, 0, tz);
    const b = localToUtcMs(next.year, next.month, next.day, 0, 0, tz);
    expect(b - a).toBe(24 * HOUR);
  });

  test("nextLocalDay across month boundary", () => {
    expect(nextLocalDay(2026, 4, 30)).toEqual({ year: 2026, month: 5, day: 1 });
  });

  test("nextLocalDay across year boundary", () => {
    expect(nextLocalDay(2026, 12, 31)).toEqual({ year: 2027, month: 1, day: 1 });
  });

  test("nextLocalDay across leap-day boundary (2028 is a leap year)", () => {
    expect(nextLocalDay(2028, 2, 28)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(nextLocalDay(2028, 2, 29)).toEqual({ year: 2028, month: 3, day: 1 });
  });

  test("midnight of the spring-forward day in LA is 23h after the previous midnight", () => {
    const LA = "America/Los_Angeles";
    const prevMid = localToUtcMs(2026, 3, 7, 0, 0, LA); // PST
    const nextMid = localToUtcMs(2026, 3, 8, 0, 0, LA); // PST (still pre-DST at midnight)
    // 2026-03-07 to 2026-03-08 at midnight is a normal 24h day (DST kicks in at 02:00).
    // The 23h gap is between 2026-03-08 and 2026-03-09 midnight.
    expect(nextMid - prevMid).toBe(24 * HOUR);
    const dayAfter = localToUtcMs(2026, 3, 9, 0, 0, LA); // PDT
    expect(dayAfter - nextMid).toBe(23 * HOUR);
  });

  test("formatLocalDate zero-pads month and day", () => {
    expect(formatLocalDate(2026, 4, 5)).toBe("2026-04-05");
    expect(formatLocalDate(2026, 12, 31)).toBe("2026-12-31");
    expect(formatLocalDate(2026, 1, 1)).toBe("2026-01-01");
  });
});

describe("localPartsOf — weekday is local-anchored, not UTC-anchored", () => {
  test("Asia/Tokyo Monday 00:00 is weekday=1 even though UTC is Sunday", () => {
    const TZ = "Asia/Tokyo";
    // 2026-04-27 00:00 JST = 2026-04-26 15:00 UTC (Sunday in UTC)
    const utcMs = localToUtcMs(2026, 4, 27, 0, 0, TZ);
    expect(new Date(utcMs).getUTCDay()).toBe(0); // UTC Sun
    const lp = localPartsOf(utcMs, TZ);
    expect(lp.weekday).toBe(1); // local Mon
    expect(lp.year).toBe(2026);
    expect(lp.month).toBe(4);
    expect(lp.day).toBe(27);
    expect(lp.hour).toBe(0);
    expect(lp.minute).toBe(0);
  });

  test("Pacific/Honolulu Saturday 23:30 is weekday=6 even though UTC is Sunday", () => {
    const TZ = "Pacific/Honolulu"; // UTC-10, no DST
    // 2026-04-25 23:30 HST = 2026-04-26 09:30 UTC (Sunday)
    const utcMs = localToUtcMs(2026, 4, 25, 23, 30, TZ);
    expect(new Date(utcMs).getUTCDay()).toBe(0); // UTC Sun
    const lp = localPartsOf(utcMs, TZ);
    expect(lp.weekday).toBe(6); // local Sat
    expect(lp.day).toBe(25);
    expect(lp.hour).toBe(23);
    expect(lp.minute).toBe(30);
  });

  test("UTC weekday for a known Monday", () => {
    // 2026-04-27 is a Monday
    const lp = localPartsOf(Date.UTC(2026, 3, 27, 12, 0), "UTC");
    expect(lp.weekday).toBe(1);
  });

  test("Asia/Kolkata weekday is local-anchored across the +5:30 boundary", () => {
    const TZ = "Asia/Kolkata";
    // 2026-04-27 02:00 IST = 2026-04-26 20:30 UTC (UTC Sun, local Mon)
    const utcMs = localToUtcMs(2026, 4, 27, 2, 0, TZ);
    expect(new Date(utcMs).getUTCDay()).toBe(0); // UTC Sun
    const lp = localPartsOf(utcMs, TZ);
    expect(lp.weekday).toBe(1); // local Mon
    expect(lp.day).toBe(27);
  });
});

describe("localToUtcMs round-trip", () => {
  test("round-trips through localPartsOf for a non-DST instant", () => {
    const TZ = "Asia/Tokyo";
    const original = localToUtcMs(2026, 4, 26, 13, 45, TZ);
    const lp = localPartsOf(original, TZ);
    const roundTripped = localToUtcMs(lp.year, lp.month, lp.day, lp.hour, lp.minute, TZ);
    expect(roundTripped).toBe(original);
  });

  test("round-trips for Pacific/Chatham summer (+13:45)", () => {
    const TZ = "Pacific/Chatham";
    const original = localToUtcMs(2026, 1, 15, 9, 30, TZ);
    const lp = localPartsOf(original, TZ);
    expect(localToUtcMs(lp.year, lp.month, lp.day, lp.hour, lp.minute, TZ)).toBe(original);
  });

  test("round-trips an unambiguous PDT instant after fall-back", () => {
    const TZ = "America/Los_Angeles";
    const original = localToUtcMs(2026, 11, 1, 3, 0, TZ); // 03:00 PST
    const lp = localPartsOf(original, TZ);
    expect(localToUtcMs(lp.year, lp.month, lp.day, lp.hour, lp.minute, TZ)).toBe(original);
  });
});

describe("UTC pass-through (no offset)", () => {
  test("UTC zone returns Date.UTC directly", () => {
    expect(localToUtcMs(2026, 4, 26, 13, 45, "UTC")).toBe(Date.UTC(2026, 3, 26, 13, 45));
  });

  test("hour=0 minute=0 in UTC", () => {
    expect(localToUtcMs(2026, 4, 26, 0, 0, "UTC")).toBe(Date.UTC(2026, 3, 26, 0, 0));
  });

  test("ignores second-level precision via Date.UTC", () => {
    // localToUtcMs only takes hour+minute; seconds/ms should default to 0
    expect(localToUtcMs(2026, 4, 26, 0, 0, "UTC") % MIN).toBe(0);
  });
});
