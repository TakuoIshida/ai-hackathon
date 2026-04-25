import { describe, expect, test } from "bun:test";
import { linkInputSchema, linkUpdateSchema, ruleInput, slugSchema } from "./schemas";

describe("slugSchema", () => {
  test("accepts lowercase + digits + hyphens", () => {
    expect(() => slugSchema.parse("intro-30min")).not.toThrow();
    expect(() => slugSchema.parse("a")).not.toThrow();
  });
  test("rejects uppercase / spaces / unicode", () => {
    expect(() => slugSchema.parse("Intro")).toThrow();
    expect(() => slugSchema.parse("intro 30")).toThrow();
    expect(() => slugSchema.parse("インタビュー")).toThrow();
  });
  test("rejects too long", () => {
    expect(() => slugSchema.parse("a".repeat(65))).toThrow();
  });
});

describe("ruleInput", () => {
  test("accepts a valid weekday window", () => {
    expect(() => ruleInput.parse({ weekday: 1, startMinute: 540, endMinute: 1020 })).not.toThrow();
  });
  test("rejects start >= end", () => {
    expect(() => ruleInput.parse({ weekday: 1, startMinute: 540, endMinute: 540 })).toThrow();
    expect(() => ruleInput.parse({ weekday: 1, startMinute: 600, endMinute: 540 })).toThrow();
  });
  test("rejects out-of-range weekday", () => {
    expect(() => ruleInput.parse({ weekday: 7, startMinute: 0, endMinute: 60 })).toThrow();
  });
  test("accepts endMinute === 24*60", () => {
    expect(() => ruleInput.parse({ weekday: 1, startMinute: 0, endMinute: 1440 })).not.toThrow();
  });
});

describe("linkInputSchema", () => {
  const minimal = {
    slug: "intro",
    title: "Intro",
    durationMinutes: 30,
    timeZone: "Asia/Tokyo",
  };

  test("applies defaults", () => {
    const parsed = linkInputSchema.parse(minimal);
    expect(parsed.bufferBeforeMinutes).toBe(0);
    expect(parsed.bufferAfterMinutes).toBe(0);
    expect(parsed.leadTimeHours).toBe(0);
    expect(parsed.rangeDays).toBe(60);
    expect(parsed.isPublished).toBe(false);
    expect(parsed.rules).toEqual([]);
    expect(parsed.excludes).toEqual([]);
  });

  test("rejects invalid duration", () => {
    expect(() => linkInputSchema.parse({ ...minimal, durationMinutes: 0 })).toThrow();
    expect(() => linkInputSchema.parse({ ...minimal, durationMinutes: -10 })).toThrow();
  });

  test("rejects malformed exclude date", () => {
    expect(() => linkInputSchema.parse({ ...minimal, excludes: ["2026/04/27"] })).toThrow();
    expect(() => linkInputSchema.parse({ ...minimal, excludes: ["2026-4-27"] })).toThrow();
  });

  test("accepts valid full payload", () => {
    expect(() =>
      linkInputSchema.parse({
        ...minimal,
        description: "30 min meeting",
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        slotIntervalMinutes: 30,
        maxPerDay: 5,
        leadTimeHours: 2,
        rangeDays: 30,
        isPublished: true,
        rules: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 780, endMinute: 1020 },
        ],
        excludes: ["2026-04-29", "2026-05-03"],
      }),
    ).not.toThrow();
  });
});

describe("linkUpdateSchema", () => {
  test("allows partial input", () => {
    expect(() => linkUpdateSchema.parse({ title: "new" })).not.toThrow();
    expect(() => linkUpdateSchema.parse({ rules: [] })).not.toThrow();
    expect(() => linkUpdateSchema.parse({})).not.toThrow();
  });
});
