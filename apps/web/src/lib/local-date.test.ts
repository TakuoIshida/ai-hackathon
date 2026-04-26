import { describe, expect, it } from "vitest";
import { buildMonthGrid, formatLocalDate, formatLocalTime, localDayStartMs } from "./local-date";

describe("formatLocalDate", () => {
  it("formats UTC instant in JST", () => {
    // 2026-04-26 14:30 UTC = 2026-04-26 23:30 JST
    expect(formatLocalDate(new Date("2026-04-26T14:30:00Z"), "Asia/Tokyo")).toBe("2026-04-26");
    // 2026-04-26 16:00 UTC = 2026-04-27 01:00 JST → date rolls over
    expect(formatLocalDate(new Date("2026-04-26T16:00:00Z"), "Asia/Tokyo")).toBe("2026-04-27");
  });
});

describe("formatLocalTime", () => {
  it("formats time in 24h", () => {
    expect(formatLocalTime(new Date("2026-04-26T14:30:00Z"), "Asia/Tokyo")).toBe("23:30");
    expect(formatLocalTime(new Date("2026-04-26T00:00:00Z"), "Asia/Tokyo")).toBe("09:00");
  });
});

describe("localDayStartMs", () => {
  it("returns UTC ms for 00:00 local in JST", () => {
    // 2026-04-26 00:00 JST = 2026-04-25 15:00 UTC
    const ms = localDayStartMs(2026, 4, 26, "Asia/Tokyo");
    expect(new Date(ms).toISOString()).toBe("2026-04-25T15:00:00.000Z");
  });

  it("handles DST spring-forward in America/Los_Angeles", () => {
    // 2026-03-08 02:00 → 03:00. Day starts at 00:00 PST (UTC-8) = 08:00 UTC.
    const ms = localDayStartMs(2026, 3, 8, "America/Los_Angeles");
    expect(new Date(ms).toISOString()).toBe("2026-03-08T08:00:00.000Z");
  });
});

describe("buildMonthGrid", () => {
  it("returns 42 cells starting on the Sunday on or before the 1st", () => {
    // April 2026: 1st is Wednesday → grid starts March 29 (Sunday)
    const grid = buildMonthGrid(2026, 4);
    expect(grid.length).toBe(42);
    expect(grid[0]?.date).toBe("2026-03-29");
    // Last cell is May 9, 2026
    expect(grid[41]?.date).toBe("2026-05-09");
    expect(grid.some((d) => d.date === "2026-04-26")).toBe(true);
  });
});
