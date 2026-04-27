import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import type { CreateLinkCommand } from "./domain";
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

const baseInput = (overrides: Partial<CreateLinkCommand> = {}): CreateLinkCommand => ({
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

// ---------- ISH-138: pin real-world hot paths beyond "busy: []" ----------

describe("computePublicSlots — confirmed-booking merge (ISH-138)", () => {
  // FINDING (pinned by these tests): the current `computePublicSlots`
  // implementation does NOT merge rows from the `bookings` table into the
  // `busy[]` set. The dual-booking guard lives at the DB layer via the
  // partial unique index `uniq_bookings_active_slot` on
  // (link_id, start_at) WHERE status='confirmed' (see bookings/repo.ts), and
  // `confirmBooking` re-checks slots through Google free/busy only.
  // These tests pin that behavior so a future change to merge bookings into
  // `busy` (or to filter the slot grid by them) is a deliberate, reviewed
  // change rather than a silent regression. If/when bookings are merged,
  // update these tests in the same PR.
  test("confirmed bookings are NOT auto-merged into busy by computePublicSlots", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "merge-confirmed",
        isPublished: true,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // Seed a confirmed booking sitting inside the slot grid (Mon 10:00 JST).
    const slotStart = Date.parse("2026-12-14T01:00:00.000Z"); // 10:00 JST
    const slotEnd = slotStart + 30 * 60_000;
    const { bookings } = await import("@/db/schema");
    await testDb.insert(bookings).values({
      linkId: created.link.id,
      startAt: new Date(slotStart),
      endAt: new Date(slotEnd),
      guestName: "Guest A",
      guestEmail: "guest-a@example.com",
      status: "confirmed",
    });

    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });

    // Current behavior: booking is invisible to the public slot grid.
    expect(result.busy).toEqual([]);
    expect(result.slots.length).toBe(16);
    expect(result.slots.some((s) => s.start === slotStart)).toBe(true);
  });

  test("canceled bookings are also invisible to busy (no row leakage either way)", async () => {
    // The complementary check: the implementation does not differentiate
    // status here because it doesn't read `bookings` at all. Pinning both
    // halves makes the absence of merging unambiguous.
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "merge-canceled",
        isPublished: true,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    const slotStart = Date.parse("2026-12-14T01:00:00.000Z"); // 10:00 JST Mon
    const slotEnd = slotStart + 30 * 60_000;
    const { bookings } = await import("@/db/schema");
    await testDb.insert(bookings).values({
      linkId: created.link.id,
      startAt: new Date(slotStart),
      endAt: new Date(slotEnd),
      guestName: "Guest A",
      guestEmail: "guest-a@example.com",
      status: "canceled",
      canceledAt: new Date(),
    });

    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });
    expect(result.busy).toEqual([]);
    expect(result.slots.some((s) => s.start === slotStart)).toBe(true);
  });
});

describe("computePublicSlots — non-published links (ISH-138)", () => {
  // FINDING: `computePublicSlots` itself does NOT check `isPublished`.
  // The publish gate lives at the route layer in `findPublishedLinkBySlug`
  // (apps/api/src/links/repo.ts). Once a `LinkWithRelations` is in hand,
  // the usecase will compute slots regardless of the flag. These tests pin
  // that contract so a refactor that moves the gate into the usecase is
  // deliberate.
  test("isPublished=false still returns slots when called directly (gate is at route layer)", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "draft",
        isPublished: false,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");
    expect(created.link.isPublished).toBe(false);

    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });
    expect(result.slots.length).toBe(16);
  });
});

describe("computePublicSlots — excludes × weekly rule interaction (ISH-138)", () => {
  test("an exclude on a weekday-rule day removes all of that day's slots", async () => {
    const userId = await seedUser();
    // Mon + Tue 9-17 JST, but exclude the Tuesday.
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "exclude-mid",
        isPublished: true,
        rules: [
          { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
        excludes: ["2026-12-15"], // Tuesday in JST
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // Mon 00:00 JST → Wed 00:00 JST (covers both Mon and Tue).
    const fromMs = Date.parse("2026-12-13T15:00:00.000Z"); // Mon 00:00 JST
    const toMs = fromMs + 2 * 24 * 60 * 60_000; // Wed 00:00 JST
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });
    // Mon gets all 16 slots, Tue is fully excluded → 16 total.
    expect(result.slots.length).toBe(16);
    // No slot should fall on the excluded JST date.
    const tueStart = Date.parse("2026-12-14T15:00:00.000Z"); // Tue 00:00 JST
    const tueEnd = Date.parse("2026-12-15T15:00:00.000Z"); // Wed 00:00 JST
    expect(result.slots.some((s) => s.start >= tueStart && s.start < tueEnd)).toBe(false);
  });

  test("exclude on the rangeStart day suppresses that day's slots", async () => {
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "exclude-start",
        isPublished: true,
        rules: [
          { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
        excludes: ["2026-12-14"], // Mon in JST = the rangeStart day
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    const fromMs = Date.parse("2026-12-13T15:00:00.000Z"); // Mon 00:00 JST
    const toMs = fromMs + 2 * 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });
    // Mon excluded, Tue full → 16 slots, all on Tuesday JST.
    expect(result.slots.length).toBe(16);
    const tueStart = Date.parse("2026-12-14T15:00:00.000Z");
    expect(result.slots.every((s) => s.start >= tueStart)).toBe(true);
  });

  test("exclude on the day at rangeEnd is moot when range is exclusive of that day", async () => {
    // Range: Mon 00:00 JST → Tue 00:00 JST (exclusive). Tuesday is not part
    // of the range anyway, so excluding it must not affect Mon's slot count.
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "exclude-end-boundary",
        isPublished: true,
        rules: [
          { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
          { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
        ],
        excludes: ["2026-12-15"], // Tue — sits at the exclusive end-boundary
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    const fromMs = Date.parse("2026-12-13T15:00:00.000Z"); // Mon 00:00 JST
    const toMs = fromMs + 24 * 60 * 60_000; // Tue 00:00 JST (exclusive)
    const result = await computePublicSlots(db, created.link, {
      fromMs,
      toMs,
      nowMs: fromMs - 24 * 60 * 60_000,
    });
    expect(result.slots.length).toBe(16);
  });
});

describe("computePublicSlots — rangeDays horizon (ISH-138)", () => {
  test("the final horizon day's slots are still returned", async () => {
    const userId = await seedUser();
    // rangeDays=7 → horizon = nowMs + 7 days. Open every weekday so we can
    // land slots on the last day deterministically.
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "horizon-last",
        isPublished: true,
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
    const userId = await seedUser();
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "horizon-past",
        isPublished: true,
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

describe("computePublicSlots — leadTimeHours boundary (ISH-138)", () => {
  test("a slot whose start is before now+leadTime is excluded", async () => {
    const userId = await seedUser();
    // leadTimeHours=2 → only slots starting >= now+2h are eligible.
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "lead-2h",
        isPublished: true,
        leadTimeHours: 2,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // now = Mon 2026-12-14 10:00 JST → leadEnd = 12:00 JST.
    const nowMs = Date.parse("2026-12-14T01:00:00.000Z"); // 10:00 JST Mon
    const fromMs = Date.parse("2026-12-13T15:00:00.000Z"); // Mon 00:00 JST
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, { fromMs, toMs, nowMs });

    // No slot may start before leadEnd.
    const leadEnd = nowMs + 2 * 60 * 60_000; // 12:00 JST
    expect(result.slots.every((s) => s.start >= leadEnd)).toBe(true);
    // The 11:30 JST slot (start=2026-12-14T02:30:00Z, just before leadEnd)
    // must be excluded; the 12:00 JST slot must be included.
    const before = Date.parse("2026-12-14T02:30:00.000Z");
    const at = Date.parse("2026-12-14T03:00:00.000Z");
    expect(result.slots.some((s) => s.start === before)).toBe(false);
    expect(result.slots.some((s) => s.start === at)).toBe(true);
    // 12:00 → 17:00 JST = 5 hours, 30-min step → 10 slots.
    expect(result.slots.length).toBe(10);
  });

  test("a slot whose start equals now+leadTime exactly IS included (inclusive boundary)", async () => {
    const userId = await seedUser();
    // leadTimeHours=1 → leadEnd is exactly on a slot grid boundary.
    const created = await createLinkForUser(
      db,
      userId,
      baseInput({
        slug: "lead-1h-edge",
        isPublished: true,
        leadTimeHours: 1,
        rules: [{ weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }],
      }),
    );
    if (created.kind !== "ok") throw new Error("seed failed");

    // now = Mon 09:00 JST → leadEnd = 10:00 JST. The 10:00 slot must be included.
    const nowMs = Date.parse("2026-12-14T00:00:00.000Z"); // 09:00 JST Mon
    const fromMs = Date.parse("2026-12-13T15:00:00.000Z");
    const toMs = fromMs + 24 * 60 * 60_000;
    const result = await computePublicSlots(db, created.link, { fromMs, toMs, nowMs });

    const at = Date.parse("2026-12-14T01:00:00.000Z"); // 10:00 JST
    expect(result.slots.some((s) => s.start === at)).toBe(true);
    expect(result.slots[0]?.start).toBe(at);
    // 10:00 → 17:00 JST = 7 hours, 30-min step → 14 slots.
    expect(result.slots.length).toBe(14);
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
