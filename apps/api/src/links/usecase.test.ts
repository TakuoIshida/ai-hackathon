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
  type GooglePort,
  getCoOwnersForLink,
  getLink,
  listLinks,
  setCoOwnersForLink,
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
    TRUNCATE TABLE bookings, link_owners, availability_excludes, availability_rules,
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

  test("GooglePort is skipped when the owner has no OAuth account row", async () => {
    // The owner is not connected to Google → port is never invoked even though
    // it's passed in. This is the "OAuth-not-connected" production path.
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "no-oauth",
        isPublished: true,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    let getTokenCalls = 0;
    let getFreeBusyCalls = 0;
    const port: GooglePort = {
      getValidAccessToken: async () => {
        getTokenCalls++;
        return "fake-token";
      },
      getFreeBusy: async () => {
        getFreeBusyCalls++;
        return [];
      },
    };
    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(
      db,
      created.link,
      { fromMs, toMs, nowMs: fromMs - 24 * 60 * 60_000 },
      port,
    );
    expect(getTokenCalls).toBe(0);
    expect(getFreeBusyCalls).toBe(0);
    expect(result.busy).toEqual([]);
    expect(result.slots.length).toBe(16);
  });

  test("GooglePort failure for one owner is logged and skipped (slots still returned)", async () => {
    // The recheck path's per-owner try/catch must keep the slot grid usable
    // even if one owner's Google connection is broken. We seed an OAuth row
    // for the owner so the port gets called, then make the port throw.
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "broken-oauth",
        isPublished: true,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // Seed an OAuth row so `computePublicSlots` actually calls the port.
    const { googleOauthAccounts } = await import("@/db/schema");
    await testDb.insert(googleOauthAccounts).values({
      userId,
      googleUserId: `g_${randomUUID()}`,
      email: "owner@example.com",
      encryptedRefreshToken: "ct",
      refreshTokenIv: "iv",
      refreshTokenAuthTag: "tag",
      accessToken: "at",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: "calendar.events",
    });

    let getTokenCalls = 0;
    const port: GooglePort = {
      getValidAccessToken: async () => {
        getTokenCalls++;
        throw new Error("token boom");
      },
      getFreeBusy: async () => {
        throw new Error("must not be called when token fetch fails");
      },
    };
    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(
      db,
      created.link,
      { fromMs, toMs, nowMs: fromMs - 24 * 60 * 60_000 },
      port,
    );
    expect(getTokenCalls).toBe(1);
    expect(result.busy).toEqual([]);
    expect(result.slots.length).toBe(16);
  });
});

describe("links/usecase: co-owner management (ISH-112)", () => {
  test("getCoOwnersForLink returns ok with empty list initially", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, baseInput({ slug: "co-empty" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await getCoOwnersForLink(db, userId, created.link.id);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.coOwnerIds).toEqual([]);
  });

  test("getCoOwnersForLink returns not_found when user does not own the link", async () => {
    const owner = await seedUser();
    const stranger = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "stranger@x.com",
      name: null,
    });
    const created = await createLinkForUser(db, owner, baseInput({ slug: "co-scoped" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await getCoOwnersForLink(db, stranger.id, created.link.id);
    expect(result.kind).toBe("not_found");
  });

  test("setCoOwnersForLink replaces and returns the new set", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, baseInput({ slug: "co-replace" }));
    if (created.kind !== "ok") throw new Error("seed");
    const u2 = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    const u3 = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "u3@x.com",
      name: null,
    });
    const result = await setCoOwnersForLink(db, userId, created.link.id, [u2.id, u3.id]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.coOwnerIds.sort()).toEqual([u2.id, u3.id].sort());
  });

  test("setCoOwnersForLink returns not_found when caller is not the primary owner", async () => {
    const owner = await seedUser();
    const stranger = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "stranger@x.com",
      name: null,
    });
    const created = await createLinkForUser(db, owner, baseInput({ slug: "co-403" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await setCoOwnersForLink(db, stranger.id, created.link.id, []);
    expect(result.kind).toBe("not_found");
  });

  test("setCoOwnersForLink rejects empty-string user IDs", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, baseInput({ slug: "co-bad" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await setCoOwnersForLink(db, userId, created.link.id, [""]);
    expect(result.kind).toBe("invalid");
  });
});
