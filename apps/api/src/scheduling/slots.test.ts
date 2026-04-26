import { describe, expect, test } from "bun:test";
import { expandWeeklyAvailability } from "./availability";
import { computeAvailableSlots } from "./slots";
import { localPartsOf, localToUtcMs } from "./timezone";
import type { AvailabilityWindow, Interval, WeeklyAvailability } from "./types";

const empty: WeeklyAvailability = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
const TZ = "Asia/Tokyo";

const win = (
  startY: number,
  startM: number,
  startD: number,
  startH: number,
  startMin: number,
  endH: number,
  endMin: number,
  localDate?: string,
): AvailabilityWindow => ({
  start: localToUtcMs(startY, startM, startD, startH, startMin, TZ),
  end: localToUtcMs(startY, startM, startD, endH, endMin, TZ),
  localDate:
    localDate ?? `${startY}-${String(startM).padStart(2, "0")}-${String(startD).padStart(2, "0")}`,
});

const busyAt = (
  y: number,
  m: number,
  d: number,
  sh: number,
  sm: number,
  eh: number,
  em: number,
): Interval => ({
  start: localToUtcMs(y, m, d, sh, sm, TZ),
  end: localToUtcMs(y, m, d, eh, em, TZ),
});

describe("computeAvailableSlots", () => {
  test("generates slots at duration cadence by default", () => {
    const w = win(2026, 4, 27, 9, 0, 11, 0);
    const slots = computeAvailableSlots({
      rangeStart: w.start,
      rangeEnd: w.end,
      windows: [w],
      busy: [],
      durationMinutes: 30,
    });
    expect(slots.length).toBe(4);
    expect(slots[0]?.start).toBe(localToUtcMs(2026, 4, 27, 9, 0, TZ));
    expect(slots[3]?.start).toBe(localToUtcMs(2026, 4, 27, 10, 30, TZ));
  });

  test("respects custom slotIntervalMinutes", () => {
    const w = win(2026, 4, 27, 9, 0, 11, 0);
    const slots = computeAvailableSlots({
      rangeStart: w.start,
      rangeEnd: w.end,
      windows: [w],
      busy: [],
      durationMinutes: 30,
      slotIntervalMinutes: 60,
    });
    expect(slots.map((s) => s.start)).toEqual([
      localToUtcMs(2026, 4, 27, 9, 0, TZ),
      localToUtcMs(2026, 4, 27, 10, 0, TZ),
    ]);
  });

  test("excludes slots that overlap busy", () => {
    const w = win(2026, 4, 27, 9, 0, 12, 0);
    const slots = computeAvailableSlots({
      rangeStart: w.start,
      rangeEnd: w.end,
      windows: [w],
      busy: [busyAt(2026, 4, 27, 10, 0, 11, 0)],
      durationMinutes: 30,
    });
    // 9:00, 9:30 OK; 10:00, 10:30 conflict; 11:00, 11:30 OK
    expect(slots.length).toBe(4);
    expect(slots.map((s) => s.start)).toEqual([
      localToUtcMs(2026, 4, 27, 9, 0, TZ),
      localToUtcMs(2026, 4, 27, 9, 30, TZ),
      localToUtcMs(2026, 4, 27, 11, 0, TZ),
      localToUtcMs(2026, 4, 27, 11, 30, TZ),
    ]);
  });

  test("buffer before/after extends the conflict check", () => {
    const w = win(2026, 4, 27, 9, 0, 12, 0);
    const slots = computeAvailableSlots({
      rangeStart: w.start,
      rangeEnd: w.end,
      windows: [w],
      busy: [busyAt(2026, 4, 27, 10, 0, 11, 0)],
      durationMinutes: 30,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
    });
    // 9:00 (8:45-9:30 vs 10-11) ok
    // 9:30 (9:15-10:15) conflicts
    // 10:00,10:30 conflict
    // 11:00 (10:45-11:45) conflicts
    // 11:30 (11:15-12:15) ok
    expect(slots.map((s) => s.start)).toEqual([
      localToUtcMs(2026, 4, 27, 9, 0, TZ),
      localToUtcMs(2026, 4, 27, 11, 30, TZ),
    ]);
  });

  test("maxPerDay caps slots per local date", () => {
    const w1 = win(2026, 4, 27, 9, 0, 17, 0);
    const w2 = win(2026, 4, 28, 9, 0, 17, 0);
    const slots = computeAvailableSlots({
      rangeStart: w1.start,
      rangeEnd: w2.end,
      windows: [w1, w2],
      busy: [],
      durationMinutes: 60,
      maxPerDay: 3,
    });
    expect(slots.length).toBe(6);
    const day1 = slots.filter((s) => s.start < w2.start);
    const day2 = slots.filter((s) => s.start >= w2.start);
    expect(day1.length).toBe(3);
    expect(day2.length).toBe(3);
  });

  test("maxPerDay with split windows on same day buckets together", () => {
    const morning: AvailabilityWindow = win(2026, 4, 27, 9, 0, 12, 0);
    const afternoon: AvailabilityWindow = win(2026, 4, 27, 13, 0, 17, 0);
    const slots = computeAvailableSlots({
      rangeStart: morning.start,
      rangeEnd: afternoon.end,
      windows: [morning, afternoon],
      busy: [],
      durationMinutes: 60,
      maxPerDay: 4,
    });
    expect(slots.length).toBe(4);
    expect(slots[3]?.start).toBe(localToUtcMs(2026, 4, 27, 13, 0, TZ));
  });

  test("rangeStart trims earlier slots in window", () => {
    const w = win(2026, 4, 27, 9, 0, 12, 0);
    const rangeStart = localToUtcMs(2026, 4, 27, 10, 15, TZ);
    const slots = computeAvailableSlots({
      rangeStart,
      rangeEnd: w.end,
      windows: [w],
      busy: [],
      durationMinutes: 30,
    });
    // first valid slot ≥ 10:15 anchored to 9:00+30k => 10:30
    expect(slots[0]?.start).toBe(localToUtcMs(2026, 4, 27, 10, 30, TZ));
  });

  test("returns empty for inverted range", () => {
    const w = win(2026, 4, 27, 9, 0, 12, 0);
    expect(
      computeAvailableSlots({
        rangeStart: w.end,
        rangeEnd: w.start,
        windows: [w],
        busy: [],
        durationMinutes: 30,
      }),
    ).toEqual([]);
  });

  test("returns empty when window shorter than duration", () => {
    const w = win(2026, 4, 27, 9, 0, 9, 20);
    const slots = computeAvailableSlots({
      rangeStart: w.start,
      rangeEnd: w.end,
      windows: [w],
      busy: [],
      durationMinutes: 30,
    });
    expect(slots).toEqual([]);
  });

  test("DST spring-forward: slot anchor stays UTC-spaced and local 02:00 is skipped", () => {
    // Window: 2026-03-08 00:00 → 24:00 LA. The day is 23h long because 02:00 → 03:00.
    const LA = "America/Los_Angeles";
    const dayStart = localToUtcMs(2026, 3, 8, 0, 0, LA);
    const dayEnd = localToUtcMs(2026, 3, 9, 0, 0, LA);
    const w: AvailabilityWindow = {
      start: dayStart,
      end: dayEnd,
      localDate: "2026-03-08",
    };
    const slots = computeAvailableSlots({
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      windows: [w],
      busy: [],
      durationMinutes: 60,
    });
    // 23h window / 60min step = 23 slots
    expect(slots.length).toBe(23);
    // Slot starts are equally spaced in UTC by exactly 60 min.
    for (let i = 1; i < slots.length; i++) {
      expect((slots[i]?.start ?? 0) - (slots[i - 1]?.start ?? 0)).toBe(60 * 60 * 1000);
    }
    // Local hours: slots drift past the gap, so 02:00 local never appears.
    const localHours = slots.map((s) => localPartsOf(s.start, LA).hour);
    expect(localHours).not.toContain(2);
    expect(localHours[0]).toBe(0);
    expect(localHours[1]).toBe(1);
    // Third slot (UTC 10:00) lands on 03:00 PDT — the gap is skipped.
    expect(localHours[2]).toBe(3);
    expect(localHours.at(-1)).toBe(23);
  });

  test("DST fall-back: 01:00 local appears twice (once PDT, once PST)", () => {
    // Window: 2026-11-01 00:00 → 24:00 LA. The day is 25h long because 02:00 → 01:00.
    const LA = "America/Los_Angeles";
    const dayStart = localToUtcMs(2026, 11, 1, 0, 0, LA);
    const dayEnd = localToUtcMs(2026, 11, 2, 0, 0, LA);
    const w: AvailabilityWindow = {
      start: dayStart,
      end: dayEnd,
      localDate: "2026-11-01",
    };
    const slots = computeAvailableSlots({
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      windows: [w],
      busy: [],
      durationMinutes: 60,
    });
    // 25h window / 60min step = 25 slots
    expect(slots.length).toBe(25);
    const localHours = slots.map((s) => localPartsOf(s.start, LA).hour);
    expect(localHours[0]).toBe(0);
    expect(localHours[1]).toBe(1); // 01:00 PDT (first occurrence)
    expect(localHours[2]).toBe(1); // 01:00 PST (second occurrence after fall-back)
    expect(localHours[3]).toBe(2);
    // 23:00 is the final slot (24th hour of a 25h day).
    expect(localHours.at(-1)).toBe(23);
    // The two 01:00 slots are exactly 1 hour apart in UTC.
    expect((slots[2]?.start ?? 0) - (slots[1]?.start ?? 0)).toBe(60 * 60 * 1000);
  });

  test("DST spring-forward with maxPerDay still buckets by localDate", () => {
    // Same all-day window but capped at 5 slots/day.
    const LA = "America/Los_Angeles";
    const dayStart = localToUtcMs(2026, 3, 8, 0, 0, LA);
    const dayEnd = localToUtcMs(2026, 3, 9, 0, 0, LA);
    const w: AvailabilityWindow = {
      start: dayStart,
      end: dayEnd,
      localDate: "2026-03-08",
    };
    const slots = computeAvailableSlots({
      rangeStart: dayStart,
      rangeEnd: dayEnd,
      windows: [w],
      busy: [],
      durationMinutes: 60,
      maxPerDay: 5,
    });
    expect(slots.length).toBe(5);
    expect(slots[0]?.start).toBe(dayStart);
    expect(slots[4]?.start).toBe(dayStart + 4 * 60 * 60 * 1000);
  });

  test("integrates with expandWeeklyAvailability", () => {
    const weekly: WeeklyAvailability = {
      ...empty,
      1: [{ startMinute: 9 * 60, endMinute: 11 * 60 }],
      3: [{ startMinute: 14 * 60, endMinute: 16 * 60 }],
    };
    const rangeStart = localToUtcMs(2026, 4, 27, 0, 0, TZ); // Mon
    const rangeEnd = localToUtcMs(2026, 5, 4, 0, 0, TZ); // next Mon (exclusive)
    const windows = expandWeeklyAvailability({
      timeZone: TZ,
      weekly,
      rangeStart,
      rangeEnd,
    });
    const slots = computeAvailableSlots({
      rangeStart,
      rangeEnd,
      windows,
      busy: [busyAt(2026, 4, 29, 14, 0, 14, 30)],
      durationMinutes: 60,
    });
    expect(slots.length).toBe(3);
    expect(slots.map((s) => s.start)).toEqual([
      localToUtcMs(2026, 4, 27, 9, 0, TZ),
      localToUtcMs(2026, 4, 27, 10, 0, TZ),
      localToUtcMs(2026, 4, 29, 15, 0, TZ),
    ]);
  });
});
