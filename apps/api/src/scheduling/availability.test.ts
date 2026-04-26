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

  test("DST fall-back in America/Los_Angeles produces a 25h Sunday", () => {
    const tz = "America/Los_Angeles";
    // 2026-11-01 fall back at 02:00 PDT → 01:00 PST
    const rangeStart = localToUtcMs(2026, 11, 1, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 11, 2, 0, 0, tz);
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
    expect(windows.length).toBe(1);
    expect(windows[0]?.localDate).toBe("2026-11-01");
    // Fall-back day is 25h long
    expect((windows[0]?.end ?? 0) - (windows[0]?.start ?? 0)).toBe(25 * 60 * 60 * 1000);
    // The window must align with the calendar day boundaries
    expect(windows[0]?.start).toBe(rangeStart);
    expect(windows[0]?.end).toBe(rangeEnd);
  });

  test("DST fall-back: 9-17 window length is unaffected (DST jump is at night)", () => {
    const tz = "America/Los_Angeles";
    // 9-17 sits entirely after the fall-back; should still be exactly 8h.
    const rangeStart = localToUtcMs(2026, 11, 1, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 11, 2, 0, 0, tz);
    const sundayWork: WeeklyAvailability = {
      ...empty,
      0: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
    };
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: sundayWork,
      rangeStart,
      rangeEnd,
    });
    expect(windows.length).toBe(1);
    expect((windows[0]?.end ?? 0) - (windows[0]?.start ?? 0)).toBe(8 * 60 * 60 * 1000);
    expect(windows[0]?.start).toBe(localToUtcMs(2026, 11, 1, 9, 0, tz));
    expect(windows[0]?.end).toBe(localToUtcMs(2026, 11, 1, 17, 0, tz));
  });

  test("Pacific/Chatham (+12:45) emits correctly offset windows", () => {
    const tz = "Pacific/Chatham";
    // 2026-07-15 is a Wednesday in Chatham (winter, +12:45).
    const wednesdayWork: WeeklyAvailability = {
      ...empty,
      3: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
    };
    const rangeStart = localToUtcMs(2026, 7, 15, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 7, 16, 0, 0, tz);
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: wednesdayWork,
      rangeStart,
      rangeEnd,
    });
    expect(windows.length).toBe(1);
    expect(windows[0]?.localDate).toBe("2026-07-15");
    // 09:00 Chatham (+12:45) = previous day 20:15 UTC
    expect(windows[0]?.start).toBe(Date.UTC(2026, 6, 14, 20, 15));
    // 17:00 Chatham = same day 04:15 UTC
    expect(windows[0]?.end).toBe(Date.UTC(2026, 6, 15, 4, 15));
    expect((windows[0]?.end ?? 0) - (windows[0]?.start ?? 0)).toBe(8 * 60 * 60 * 1000);
  });

  test("Pacific/Chatham midnight-to-midnight uses +12:45 offset", () => {
    const tz = "Pacific/Chatham";
    const allDayWed: WeeklyAvailability = {
      ...empty,
      3: [{ startMinute: 0, endMinute: 24 * 60 }],
    };
    const rangeStart = localToUtcMs(2026, 7, 15, 0, 0, tz);
    const rangeEnd = localToUtcMs(2026, 7, 16, 0, 0, tz);
    const windows = expandWeeklyAvailability({
      timeZone: tz,
      weekly: allDayWed,
      rangeStart,
      rangeEnd,
    });
    expect(windows.length).toBe(1);
    expect(windows[0]?.start).toBe(rangeStart);
    expect(windows[0]?.end).toBe(rangeEnd);
    // No Chatham DST boundary on this day → exactly 24h
    expect((windows[0]?.end ?? 0) - (windows[0]?.start ?? 0)).toBe(24 * 60 * 60 * 1000);
  });
});
