import { describe, expect, test } from "bun:test";
import { rulesToWeekly } from "./domain";

describe("rulesToWeekly", () => {
  test("buckets rules by weekday", () => {
    const weekly = rulesToWeekly([
      { weekday: 1, startMinute: 540, endMinute: 720 },
      { weekday: 1, startMinute: 780, endMinute: 1020 },
      { weekday: 3, startMinute: 600, endMinute: 660 },
    ]);
    expect(weekly[1]).toEqual([
      { startMinute: 540, endMinute: 720 },
      { startMinute: 780, endMinute: 1020 },
    ]);
    expect(weekly[3]).toEqual([{ startMinute: 600, endMinute: 660 }]);
    expect(weekly[0]).toEqual([]);
    expect(weekly[5]).toEqual([]);
  });

  test("ignores out-of-range weekdays", () => {
    const weekly = rulesToWeekly([
      { weekday: 7, startMinute: 0, endMinute: 60 },
      { weekday: -1, startMinute: 0, endMinute: 60 },
    ]);
    for (let d = 0; d < 7; d++) {
      expect(weekly[d as 0 | 1 | 2 | 3 | 4 | 5 | 6]).toEqual([]);
    }
  });

  test("empty input yields all empty arrays", () => {
    const weekly = rulesToWeekly([]);
    expect(Object.values(weekly).every((arr) => arr.length === 0)).toBe(true);
  });
});
