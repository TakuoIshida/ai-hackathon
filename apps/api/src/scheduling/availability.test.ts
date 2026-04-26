import { describe, expect, test } from "bun:test";
import { expandWeeklyAvailability } from "./availability";
import { localToUtcMs } from "./timezone";
import type { WeeklyAvailability } from "./types";

const empty: WeeklyAvailability = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

const weekdays9to17: WeeklyAvailability = {
  ...empty,
  1: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
  2: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
  3: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
  4: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
  5: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
};

describe("expandWeeklyAvailability", () => {
  test("emits one window per weekday in Asia/Tokyo", () => {
    const tz = "Asia/Tokyo";
    const rangeStart = localToUtcMs(2026, 4, 27, 0, 0, tz); // Mon
    const rangeEnd = localToUtcMs(2026, 5, 4, 0, 0, tz); // Mon (next week, exclusive)
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: weekdays9to17,
      rangeStart,
      rangeEnd,
    });
    expect(windows.length).toBe(5);
    expect(windows[0]?.localDate).toBe("2026-04-27");
    expect(windows[4]?.localDate).toBe("2026-05-01");
    for (const w of windows) {
      expect(w.end - w.start).toBe(8 * 60 * 60 * 1000);
    }
  });

  test("respects excludeLocalDates", () => {
    const tz = "Asia/Tokyo";
    const rangeStart = localToUtcMs(2026, 4, 27, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 5, 4, 0, 0, tz);
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: weekdays9to17,
      rangeStart,
      rangeEnd,
      excludeLocalDates: ["2026-04-29", "2026-05-01"],
    });
    expect(windows.map((w) => w.localDate)).toEqual(["2026-04-27", "2026-04-28", "2026-04-30"]);
  });

  test("clamps windows that straddle range boundaries", () => {
    const tz = "Asia/Tokyo";
    // start mid-day Monday at 12:00, end mid-day Tuesday at 12:00
    const rangeStart = localToUtcMs(2026, 4, 27, 12, 0, tz);
    const rangeEnd = localToUtcMs(2026, 4, 28, 12, 0, tz);
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: weekdays9to17,
      rangeStart,
      rangeEnd,
    });
    expect(windows.length).toBe(2);
    expect(windows[0]?.start).toBe(rangeStart);
    expect(windows[0]?.end).toBe(localToUtcMs(2026, 4, 27, 17, 0, tz));
    expect(windows[1]?.start).toBe(localToUtcMs(2026, 4, 28, 9, 0, tz));
    expect(windows[1]?.end).toBe(rangeEnd);
  });

  test("handles split lunch windows", () => {
    const tz = "Asia/Tokyo";
    const split: WeeklyAvailability = {
      ...empty,
      1: [
        { startMinute: 9 * 60, endMinute: 12 * 60 },
        { startMinute: 13 * 60, endMinute: 17 * 60 },
      ],
    };
    const rangeStart = localToUtcMs(2026, 4, 27, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 4, 28, 0, 0, tz);
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: split,
      rangeStart,
      rangeEnd,
    });
    expect(windows.map((w) => w.end - w.start)).toEqual([3 * 60 * 60 * 1000, 4 * 60 * 60 * 1000]);
  });

  test("supports endMinute === 24*60 (midnight)", () => {
    const tz = "Asia/Tokyo";
    const allDay: WeeklyAvailability = {
      ...empty,
      1: [{ startMinute: 0, endMinute: 24 * 60 }],
    };
    const rangeStart = localToUtcMs(2026, 4, 27, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 4, 28, 0, 0, tz);
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: allDay,
      rangeStart,
      rangeEnd,
    });
    expect(windows.length).toBe(1);
    expect(windows[0]?.start).toBe(rangeStart);
    expect(windows[0]?.end).toBe(rangeEnd);
  });

  test("DST spring-forward in America/Los_Angeles", () => {
    const tz = "America/Los_Angeles";
    // 2026-03-08 spring forward at 02:00 → 03:00 local
    const rangeStart = localToUtcMs(2026, 3, 8, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 3, 9, 0, 0, tz);
    const sundayOnly: WeeklyAvailability = {
      ...empty,
      0: [{ startMinute: 0, endMinute: 24 * 60 }],
    };
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: sundayOnly,
      rangeStart,
      rangeEnd,
    });
    // The DST day is 23h long, not 24h
    expect(windows.map((w) => w.end - w.start)).toEqual([23 * 60 * 60 * 1000]);
  });
});
