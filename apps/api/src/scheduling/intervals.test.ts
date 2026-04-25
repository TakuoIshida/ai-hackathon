import { describe, expect, test } from "bun:test";
import {
  clamp,
  contains,
  intersectAny,
  isValidInterval,
  mergeIntervals,
  overlaps,
  subtractIntervals,
} from "./intervals";

const i = (start: number, end: number) => ({ start, end });

describe("isValidInterval", () => {
  test("rejects zero-length and reversed intervals", () => {
    expect(isValidInterval(i(0, 0))).toBe(false);
    expect(isValidInterval(i(10, 5))).toBe(false);
    expect(isValidInterval(i(0, 1))).toBe(true);
  });
});

describe("overlaps", () => {
  test("touching edges do not overlap", () => {
    expect(overlaps(i(0, 10), i(10, 20))).toBe(false);
  });
  test("partial overlap", () => {
    expect(overlaps(i(0, 10), i(5, 15))).toBe(true);
  });
  test("containment", () => {
    expect(overlaps(i(0, 100), i(10, 20))).toBe(true);
  });
});

describe("contains", () => {
  test("full containment", () => {
    expect(contains(i(0, 100), i(10, 20))).toBe(true);
    expect(contains(i(0, 100), i(0, 100))).toBe(true);
  });
  test("partial is not containment", () => {
    expect(contains(i(10, 20), i(0, 15))).toBe(false);
  });
});

describe("clamp", () => {
  test("clamps to bounds", () => {
    expect(clamp(i(0, 100), i(20, 50))).toEqual(i(20, 50));
  });
  test("returns null when outside", () => {
    expect(clamp(i(0, 10), i(20, 30))).toBeNull();
  });
  test("trims one side", () => {
    expect(clamp(i(0, 30), i(10, 100))).toEqual(i(10, 30));
  });
});

describe("mergeIntervals", () => {
  test("merges overlapping and adjacent", () => {
    expect(mergeIntervals([i(0, 5), i(5, 10), i(8, 12)])).toEqual([i(0, 12)]);
  });
  test("keeps disjoint", () => {
    expect(mergeIntervals([i(10, 20), i(0, 5)])).toEqual([i(0, 5), i(10, 20)]);
  });
  test("filters invalid", () => {
    expect(mergeIntervals([i(10, 5), i(0, 5)])).toEqual([i(0, 5)]);
  });
  test("does not mutate inputs", () => {
    const input = [i(5, 10), i(0, 5)];
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeIntervals(input);
    expect(input).toEqual(snapshot);
  });
});

describe("subtractIntervals", () => {
  test("removes fully covered slices", () => {
    expect(subtractIntervals([i(0, 100)], [i(20, 30), i(50, 60)])).toEqual([
      i(0, 20),
      i(30, 50),
      i(60, 100),
    ]);
  });
  test("cut entirely outside is a no-op", () => {
    expect(subtractIntervals([i(0, 10)], [i(100, 200)])).toEqual([i(0, 10)]);
  });
  test("cut covers entire base", () => {
    expect(subtractIntervals([i(10, 20)], [i(0, 100)])).toEqual([]);
  });
  test("multiple base segments", () => {
    expect(subtractIntervals([i(0, 10), i(20, 30)], [i(5, 25)])).toEqual([i(0, 5), i(25, 30)]);
  });
});

describe("intersectAny", () => {
  test("true when any overlaps", () => {
    expect(intersectAny(i(0, 10), [i(100, 200), i(5, 15)])).toBe(true);
  });
  test("false when none overlap", () => {
    expect(intersectAny(i(0, 10), [i(100, 200)])).toBe(false);
    expect(intersectAny(i(0, 10), [])).toBe(false);
  });
});
