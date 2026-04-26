import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import type { LinkInput } from "./schemas";
import {
  checkSlugAvailability,
  computePublicSlots,
  createLinkForUser,
  deleteLinkForUser,
  getLink,
  listLinks,
  updateLinkForUser,
} from "./usecase";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  setDbForTests(testDb);
}, 30_000);

afterAll(async () => {
  clearDbForTests();
  await testDb.$client.close();
});

beforeEach(async () => {
  await testDb.$client.exec(`
    TRUNCATE TABLE bookings, availability_excludes, availability_rules,
    availability_links, google_calendars, google_oauth_accounts, users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedUser(): Promise<string> {
  const u = await insertUser(db, {
    clerkId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  return u.id;
}

const baseInput = (overrides: Partial<LinkInput> = {}): LinkInput => ({
  slug: "intro-30",
  title: "30 min",
  description: null,
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  slotIntervalMinutes: null,
  maxPerDay: null,
  leadTimeHours: 0,
  rangeDays: 60,
  timeZone: "Asia/Tokyo",
  isPublished: false,
  rules: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  excludes: [],
  ...overrides,
});

describe("links/usecase: CRUD", () => {
  test("checkSlugAvailability reflects DB state", async () => {
    const userId = await seedUser();
    expect(await checkSlugAvailability(db, "free")).toEqual({ slug: "free", available: true });
    await createLinkForUser(db, userId, baseInput({ slug: "taken" }));
    expect(await checkSlugAvailability(db, "taken")).toEqual({ slug: "taken", available: false });
  });

  test("createLinkForUser succeeds and returns ok with link", async () => {
    const userId = await seedUser();
    const result = await createLinkForUser(db, userId, baseInput());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.link.slug).toBe("intro-30");
    }
  });

  test("createLinkForUser returns slug_taken on duplicate", async () => {
    const userId = await seedUser();
    await createLinkForUser(db, userId, baseInput({ slug: "dup" }));
    const second = await createLinkForUser(db, userId, baseInput({ slug: "dup" }));
    expect(second.kind).toBe("slug_taken");
  });

  test("listLinks returns links scoped to user", async () => {
    const userA = await seedUser();
    await createLinkForUser(db, userA, baseInput({ slug: "a" }));
    const links = await listLinks(db, userA);
    expect(links.map((l) => l.slug)).toContain("a");
  });

  test("getLink returns null when not owned", async () => {
    const userA = await seedUser();
    const userB = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "b@x.com",
      name: null,
    });
    const created = await createLinkForUser(db, userA, baseInput({ slug: "scoped" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    expect(await getLink(db, userB.id, created.link.id)).toBeNull();
  });

  test("updateLinkForUser blocks slug collision against another link", async () => {
    const userId = await seedUser();
    await createLinkForUser(db, userId, baseInput({ slug: "first" }));
    const second = await createLinkForUser(db, userId, baseInput({ slug: "second" }));
    if (second.kind !== "ok") throw new Error("seed failed");

    const result = await updateLinkForUser(db, userId, second.link.id, { slug: "first" });
    expect(result.kind).toBe("slug_taken");
  });

  test("updateLinkForUser allows keeping the same slug", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, baseInput({ slug: "stable" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    const result = await updateLinkForUser(db, userId, created.link.id, {
      slug: "stable",
      title: "Renamed",
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.link.title).toBe("Renamed");
  });

  test("updateLinkForUser returns not_found when link missing", async () => {
    const userId = await seedUser();
    const result = await updateLinkForUser(db, userId, randomUUID(), { title: "x" });
    expect(result.kind).toBe("not_found");
  });

  test("deleteLinkForUser returns true on delete, false otherwise", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, baseInput({ slug: "to-delete" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    expect(await deleteLinkForUser(db, userId, created.link.id)).toBe(true);
    expect(await deleteLinkForUser(db, userId, created.link.id)).toBe(false);
  });
});

describe("links/usecase: computePublicSlots", () => {
  test("returns empty when range is fully clamped by leadTime/horizon", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({ slug: "lead", leadTimeHours: 1000, isPublished: true }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");
    const now = Date.parse("2026-12-14T05:00:00.000Z");
    const result = await computePublicSlots(db, created.link, {
      fromMs: now,
      toMs: now + 60 * 60_000,
      nowMs: now,
    });
    expect(result.slots).toEqual([]);
    expect(result.effectiveRange).toBeNull();
  });

  test("computes slots within Mon 09:00–17:00 JST window", async () => {
    const userId = await seedUser();
    // Mon-Fri 9-17 JST
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "weekday",
        isPublished: true,
        rules: [
          { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");
    // 2026-12-14 (Mon) JST 00:00 → UTC 2026-12-13T15:00:00Z
    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });
    // 9:00-17:00 JST = 8 hours, 30-min slots = 16 slots
    expect(result.slots.length).toBe(16);
    expect(result.busy).toEqual([]);
  });
});
