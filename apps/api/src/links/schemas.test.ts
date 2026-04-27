import { describe, expect, test } from "bun:test";
import {
  linkInputSchema,
  linkUpdateSchema,
  ruleInput,
  slugSchema,
  toCreateLinkCommand,
  toUpdateLinkCommand,
} from "./schemas";

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

describe("toCreateLinkCommand", () => {
  const baseWire = linkInputSchema.parse({
    slug: "intro",
    title: "Intro",
    durationMinutes: 30,
    timeZone: "Asia/Tokyo",
  });

  test("normalizes nullable+optional fields to null", () => {
    // omitting description / slotIntervalMinutes / maxPerDay → undefined on the
    // wire shape, but the command should always have null in those slots so the
    // repo never has to deal with `undefined` for nullable columns.
    const cmd = toCreateLinkCommand(baseWire);
    expect(cmd.description).toBeNull();
    expect(cmd.slotIntervalMinutes).toBeNull();
    expect(cmd.maxPerDay).toBeNull();
  });

  test("preserves explicit nulls", () => {
    const cmd = toCreateLinkCommand({
      ...baseWire,
      description: null,
      slotIntervalMinutes: null,
      maxPerDay: null,
    });
    expect(cmd.description).toBeNull();
    expect(cmd.slotIntervalMinutes).toBeNull();
    expect(cmd.maxPerDay).toBeNull();
  });

  test("forwards all defaulted scalar fields", () => {
    const cmd = toCreateLinkCommand(baseWire);
    expect(cmd.bufferBeforeMinutes).toBe(0);
    expect(cmd.bufferAfterMinutes).toBe(0);
    expect(cmd.leadTimeHours).toBe(0);
    expect(cmd.rangeDays).toBe(60);
    expect(cmd.isPublished).toBe(false);
    expect(cmd.rules).toEqual([]);
    expect(cmd.excludes).toEqual([]);
  });
});

describe("toUpdateLinkCommand", () => {
  // NOTE: `linkUpdateSchema = linkInputSchema.partial()` keeps the inner
  // `.default(...)` annotations, so Zod still fills defaults for fields like
  // `bufferBeforeMinutes` even when the user omitted them in PATCH. The mapper
  // forwards every key whose value is not `undefined`, so those defaults flow
  // through. This is the existing PATCH behaviour (unchanged by ISH-124) —
  // the tests below pin it so any future change is intentional.

  test("only-default fields are filled by Zod and forwarded", () => {
    const cmd = toUpdateLinkCommand(linkUpdateSchema.parse({}));
    expect(cmd).toEqual({
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      leadTimeHours: 0,
      rangeDays: 60,
      isPublished: false,
      rules: [],
      excludes: [],
    });
  });

  test("user-supplied keys override Zod defaults", () => {
    const cmd = toUpdateLinkCommand(linkUpdateSchema.parse({ title: "renamed" }));
    expect(cmd.title).toBe("renamed");
  });

  test("explicit null on description is preserved (vs missing key)", () => {
    const cmd = toUpdateLinkCommand(linkUpdateSchema.parse({ description: null }));
    expect("description" in cmd).toBe(true);
    expect(cmd.description).toBeNull();
  });

  // Pin the mapper's narrow contract independently of Zod's parse step:
  // given a literal input with truly missing keys, the output must also be
  // missing those keys (not `undefined`). This is what `repo.linkColumnsForUpsert`
  // relies on to leave columns alone.
  test("genuinely missing keys do not appear in the output (post-Zod contract)", () => {
    const cmd = toUpdateLinkCommand({ title: "renamed" });
    expect("rangeDays" in cmd).toBe(false);
    expect("isPublished" in cmd).toBe(false);
  });
});
