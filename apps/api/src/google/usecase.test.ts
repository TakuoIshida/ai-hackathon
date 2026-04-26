import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { googleCalendars } from "@/db/schema/google";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { findCalendarById, upsertOauthAccount } from "./repo";
import { updateCalendarFlagsForUser } from "./usecase";

let testDb: TestDb;
const ENC_KEY = Buffer.alloc(32, 7);

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
    TRUNCATE TABLE google_calendars, google_oauth_accounts, users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedAccountAndCalendar(opts?: { writes?: boolean }): Promise<{
  userId: string;
  accountId: string;
  calendarId: string;
}> {
  const u = await insertUser(db, {
    clerkId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  const account = await upsertOauthAccount(db, {
    userId: u.id,
    googleUserId: `g_${randomUUID()}`,
    email: "owner@example.com",
    refreshToken: "r",
    accessToken: "a",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    scope: "calendar.events",
    encryptionKey: ENC_KEY,
  });
  const [cal] = await testDb
    .insert(googleCalendars)
    .values({
      oauthAccountId: account.id,
      googleCalendarId: "primary@example.com",
      summary: "Primary",
      timeZone: "Asia/Tokyo",
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: opts?.writes ?? false,
    })
    .returning();
  if (!cal) throw new Error("seed: calendar insert failed");
  return { userId: u.id, accountId: account.id, calendarId: cal.id };
}

describe("google/usecase: updateCalendarFlagsForUser", () => {
  test("ok updates the flags and returns the row", async () => {
    const { userId, calendarId } = await seedAccountAndCalendar();
    const result = await updateCalendarFlagsForUser(db, userId, calendarId, {
      usedForBusy: false,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.calendar.usedForBusy).toBe(false);
    }
  });

  test("invalid when patch has no flags", async () => {
    const { userId, calendarId } = await seedAccountAndCalendar();
    const result = await updateCalendarFlagsForUser(db, userId, calendarId, {});
    expect(result.kind).toBe("invalid");
  });

  test("not_found when calendar id does not exist", async () => {
    const { userId } = await seedAccountAndCalendar();
    const result = await updateCalendarFlagsForUser(db, userId, randomUUID(), {
      usedForBusy: false,
    });
    expect(result.kind).toBe("not_found");
  });

  test("forbidden when user has no oauth account", async () => {
    const u = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "x@x.com",
      name: null,
    });
    const result = await updateCalendarFlagsForUser(db, u.id, randomUUID(), {
      usedForBusy: false,
    });
    expect(result.kind).toBe("forbidden");
  });

  test("forbidden when calendar belongs to another user's oauth account", async () => {
    const userA = await seedAccountAndCalendar();
    const userB = await seedAccountAndCalendar();
    const result = await updateCalendarFlagsForUser(db, userA.userId, userB.calendarId, {
      usedForBusy: false,
    });
    expect(result.kind).toBe("forbidden");
  });

  test("setting usedForWrites=true is exclusive within the same account", async () => {
    const { userId, accountId, calendarId } = await seedAccountAndCalendar({ writes: true });
    const [other] = await testDb
      .insert(googleCalendars)
      .values({
        oauthAccountId: accountId,
        googleCalendarId: "other@example.com",
        summary: "Other",
        timeZone: "Asia/Tokyo",
        isPrimary: false,
        usedForBusy: true,
        usedForWrites: false,
      })
      .returning();
    if (!other) throw new Error("seed");

    const result = await updateCalendarFlagsForUser(db, userId, other.id, {
      usedForWrites: true,
    });
    expect(result.kind).toBe("ok");
    const primary = await findCalendarById(db, calendarId);
    expect(primary?.usedForWrites).toBe(false);
    if (result.kind === "ok") expect(result.calendar.usedForWrites).toBe(true);
  });
});
