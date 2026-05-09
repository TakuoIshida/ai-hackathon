import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenants } from "@/db/schema";
import type { GooglePort } from "@/ports";
import { buildTestGooglePort } from "@/test/booking-ports";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import type { CreateLinkCommand } from "./domain";
import {
  checkSlugAvailability,
  computePublicSlots,
  createLinkForUser,
  deleteLinkForUser,
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
    TRUNCATE TABLE tenant.bookings, tenant.link_owners,
    tenant.availability_rules, tenant.availability_links, tenant.google_calendars,
    tenant.google_oauth_accounts, common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedTenant(): Promise<string> {
  const [tenant] = await testDb.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed: tenant insert failed");
  return tenant.id;
}

async function seedUser(): Promise<string> {
  const u = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  return u.id;
}

const baseInput = (overrides: Partial<CreateLinkCommand> = {}): CreateLinkCommand => ({
  slug: "intro-30",
  title: "30 min",
  description: null,
  durationMinutes: 30,
  rangeDays: 60,
  timeZone: "Asia/Tokyo",
  rules: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  ...overrides,
});

describe("links/usecase: CRUD", () => {
  test("checkSlugAvailability reflects DB state", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    expect(await checkSlugAvailability(db, "free")).toEqual({ slug: "free", available: true });
    await createLinkForUser(db, userId, tenantId, baseInput({ slug: "taken" }));
    expect(await checkSlugAvailability(db, "taken")).toEqual({ slug: "taken", available: false });
  });

  test("createLinkForUser succeeds and returns ok with link", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const result = await createLinkForUser(db, userId, tenantId, baseInput());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.link.slug).toBe("intro-30");
    }
  });

  // ISH-296 (B): slug 未指定時に usecase が自動生成する
  test("createLinkForUser generates a slug when caller omits it", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const { slug: _omit, ...rest } = baseInput();
    void _omit;
    const result = await createLinkForUser(db, userId, tenantId, rest);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.link.slug).toMatch(/^[a-z0-9]{8}$/);
    }
  });

  test("auto-generated slug avoids reserved + previously-taken slugs", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    // Simply seed a few links with auto-gen and confirm slugs are unique.
    const { slug: _omit, ...rest } = baseInput();
    void _omit;
    const a = await createLinkForUser(db, userId, tenantId, rest);
    const b = await createLinkForUser(db, userId, tenantId, rest);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    if (a.kind === "ok" && b.kind === "ok") {
      expect(a.link.slug).not.toBe(b.link.slug);
    }
  });

  test("createLinkForUser returns slug_taken on duplicate", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    await createLinkForUser(db, userId, tenantId, baseInput({ slug: "dup" }));
    const second = await createLinkForUser(db, userId, tenantId, baseInput({ slug: "dup" }));
    expect(second.kind).toBe("slug_taken");
  });

  // ISH-227: reserved slugs collide with FE app routes (flat URL after
  // /dashboard prefix removal). Reject them here so the DB never has a row
  // that shadows /availability-sharings, /calendar, etc.
  test("createLinkForUser rejects reserved slugs (collide with FE app routes)", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    for (const reserved of ["availability-sharings", "calendar", "settings", "sign-in"]) {
      const result = await createLinkForUser(db, userId, tenantId, baseInput({ slug: reserved }));
      expect(result.kind).toBe("slug_taken");
    }
  });

  test("checkSlugAvailability rejects reserved slugs", async () => {
    expect(await checkSlugAvailability(db, "calendar")).toEqual({
      slug: "calendar",
      available: false,
    });
    expect(await checkSlugAvailability(db, "Calendar")).toEqual({
      slug: "Calendar",
      available: false,
    });
  });

  test("listLinks returns links scoped to user", async () => {
    const tenantId = await seedTenant();
    const userA = await seedUser();
    await createLinkForUser(db, userA, tenantId, baseInput({ slug: "a" }));
    const links = await listLinks(db, userA);
    expect(links.map((l) => l.slug)).toContain("a");
  });

  test("getLink returns null when not owned", async () => {
    const tenantId = await seedTenant();
    const userA = await seedUser();
    const userB = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "b@x.com",
      name: null,
    });
    const created = await createLinkForUser(db, userA, tenantId, baseInput({ slug: "scoped" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    expect(await getLink(db, userB.id, created.link.id)).toBeNull();
  });

  test("updateLinkForUser blocks slug collision against another link", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    await createLinkForUser(db, userId, tenantId, baseInput({ slug: "first" }));
    const second = await createLinkForUser(db, userId, tenantId, baseInput({ slug: "second" }));
    if (second.kind !== "ok") throw new Error("seed failed");

    const result = await updateLinkForUser(db, userId, second.link.id, { slug: "first" });
    expect(result.kind).toBe("slug_taken");
  });

  test("updateLinkForUser allows keeping the same slug", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, tenantId, baseInput({ slug: "stable" }));
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
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, tenantId, baseInput({ slug: "to-delete" }));
    if (created.kind !== "ok") throw new Error("seed failed");
    expect(await deleteLinkForUser(db, userId, created.link.id)).toBe(true);
    expect(await deleteLinkForUser(db, userId, created.link.id)).toBe(false);
  });
});

describe("links/usecase: computePublicSlots", () => {
  test("returns empty when fromMs >= horizon", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({ slug: "horizon-clamp", rangeDays: 1 }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");
    const now = Date.parse("2026-12-14T05:00:00.000Z");
    // Request a window starting one day past horizon → empty grid.
    const past = now + 2 * 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, {
      fromMs: past,
      toMs: past + 60 * 60_000,
      nowMs: now,
    });
    expect(result.slots).toEqual([]);
    expect(result.effectiveRange).toBeNull();
  });

  test("computes slots within Mon 09:00–17:00 JST window", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    // Mon-Fri 9-17 JST
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({
        slug: "weekday",
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
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({
        slug: "no-oauth",
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    let getTokenCalls = 0;
    let getFreeBusyCalls = 0;
    const port: GooglePort = buildTestGooglePort(db, {
      getValidAccessToken: async () => {
        getTokenCalls++;
        return "fake-token";
      },
      getFreeBusy: async () => {
        getFreeBusyCalls++;
        return [];
      },
    });
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
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({
        slug: "broken-oauth",
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // Seed an OAuth row so `computePublicSlots` actually calls the port.
    const { googleOauthAccounts } = await import("@/db/schema");
    await testDb.insert(googleOauthAccounts).values({
      tenantId,
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
    const port: GooglePort = buildTestGooglePort(db, {
      getValidAccessToken: async () => {
        getTokenCalls++;
        throw new Error("token boom");
      },
      getFreeBusy: async () => {
        throw new Error("must not be called when token fetch fails");
      },
    });
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

describe("computePublicSlots — rangeDays horizon (ISH-138)", () => {
  test("the final horizon day's slots are still returned", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    // rangeDays=7 → horizon = nowMs + 7 days. Open every weekday so we can
    // land slots on the last day deterministically.
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({
        slug: "horizon-last",
        rangeDays: 7,
        rules: [
          { weekday: 0, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 5, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 6, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // now = Mon 2026-12-14 00:00 JST → horizon = next Mon 00:00 JST.
    // The slot grid for the day immediately before horizon must include 16 slots.
    const nowMs = Date.parse("2026-12-13T15:00:00.000Z");
    // Last horizon day in JST: 2026-12-20 (Sunday).
    const lastDayStart = Date.parse("2026-12-19T15:00:00.000Z"); // Sun 00:00 JST
    const lastDayEnd = Date.parse("2026-12-20T15:00:00.000Z"); // Mon 00:00 JST = horizon
    const result = await computePublicSlots(db, created.link, {
      fromMs: lastDayStart,
      toMs: lastDayEnd,
      nowMs,
    });
    // Slots must exist on the last horizon day.
    expect(result.slots.length).toBe(16);
    // The first slot of that day starts at 09:00 JST.
    expect(result.slots[0]?.start).toBe(Date.parse("2026-12-20T00:00:00.000Z"));
  });

  test("requesting one day past horizon returns zero slots", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({
        slug: "horizon-past",
        rangeDays: 7,
        rules: [
          { weekday: 0, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 5, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 6, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    const nowMs = Date.parse("2026-12-13T15:00:00.000Z");
    // horizon = nowMs + 7 days; this window starts AT horizon and goes 1 day past.
    const fromMs = nowMs + 7 * 24 * 60 * 60_000;
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, { fromMs, toMs, nowMs });
    expect(result.slots).toEqual([]);
    expect(result.effectiveRange).toBeNull();
  });
});

describe("links/usecase: co-owner management (ISH-112)", () => {
  test("getCoOwnersForLink returns ok with empty list initially", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, tenantId, baseInput({ slug: "co-empty" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await getCoOwnersForLink(db, userId, created.link.id);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.coOwnerIds).toEqual([]);
  });

  test("getCoOwnersForLink returns not_found when user does not own the link", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser();
    const stranger = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "stranger@x.com",
      name: null,
    });
    const created = await createLinkForUser(db, owner, tenantId, baseInput({ slug: "co-scoped" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await getCoOwnersForLink(db, stranger.id, created.link.id);
    expect(result.kind).toBe("not_found");
  });

  test("setCoOwnersForLink replaces and returns the new set", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      tenantId,
      baseInput({ slug: "co-replace" }),
    );
    if (created.kind !== "ok") throw new Error("seed");
    const u2 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    const u3 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u3@x.com",
      name: null,
    });
    const result = await setCoOwnersForLink(db, userId, created.link.id, [u2.id, u3.id]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.coOwnerIds.sort()).toEqual([u2.id, u3.id].sort());
  });

  test("setCoOwnersForLink returns not_found when caller is not the primary owner", async () => {
    const tenantId = await seedTenant();
    const owner = await seedUser();
    const stranger = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "stranger@x.com",
      name: null,
    });
    const created = await createLinkForUser(db, owner, tenantId, baseInput({ slug: "co-403" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await setCoOwnersForLink(db, stranger.id, created.link.id, []);
    expect(result.kind).toBe("not_found");
  });

  test("setCoOwnersForLink rejects empty-string user IDs", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLinkForUser(db, userId, tenantId, baseInput({ slug: "co-bad" }));
    if (created.kind !== "ok") throw new Error("seed");
    const result = await setCoOwnersForLink(db, userId, created.link.id, [""]);
    expect(result.kind).toBe("invalid");
  });
});
