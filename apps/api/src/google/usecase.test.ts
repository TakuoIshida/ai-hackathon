import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { googleCalendars, googleOauthAccounts } from "@/db/schema/google";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { findCalendarById } from "./repo";
import {
  decryptOauthRefreshToken,
  setCalendarFlags,
  updateCalendarFlagsForUser,
  upsertOauthAccountWithEncryption,
} from "./usecase";

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
  const account = await upsertOauthAccountWithEncryption(
    db,
    {
      userId: u.id,
      googleUserId: `g_${randomUUID()}`,
      email: "owner@example.com",
      refreshToken: "r",
      accessToken: "a",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: "calendar.events",
    },
    ENC_KEY,
  );
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

describe("google/usecase: upsertOauthAccountWithEncryption", () => {
  test("encrypts the refresh token and stores ciphertext (round-trip via decryptOauthRefreshToken)", async () => {
    const u = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "x@example.com",
      name: null,
    });
    const refresh = `secret-${randomUUID()}`;
    const key = randomBytes(32);
    const account = await upsertOauthAccountWithEncryption(
      db,
      {
        userId: u.id,
        googleUserId: `g_${randomUUID()}`,
        email: "x@example.com",
        refreshToken: refresh,
        accessToken: "a",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "calendar.events",
      },
      key,
    );

    // The persisted ciphertext must NOT equal the plaintext.
    expect(account.encryptedRefreshToken).not.toBe(refresh);
    expect(account.encryptedRefreshToken.length).toBeGreaterThan(0);
    expect(account.refreshTokenIv.length).toBeGreaterThan(0);
    expect(account.refreshTokenAuthTag.length).toBeGreaterThan(0);

    // Round-trip decrypt returns the original plaintext.
    expect(decryptOauthRefreshToken(account, key)).toBe(refresh);
  });

  test("upsert overwrites the encrypted fields on conflict", async () => {
    const u = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "y@example.com",
      name: null,
    });
    const googleUserId = `g_${randomUUID()}`;
    const key = randomBytes(32);
    await upsertOauthAccountWithEncryption(
      db,
      {
        userId: u.id,
        googleUserId,
        email: "y@example.com",
        refreshToken: "first-secret",
        accessToken: "a1",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "calendar.events",
      },
      key,
    );
    const account2 = await upsertOauthAccountWithEncryption(
      db,
      {
        userId: u.id,
        googleUserId,
        email: "y@example.com",
        refreshToken: "second-secret",
        accessToken: "a2",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "calendar.events",
      },
      key,
    );
    expect(decryptOauthRefreshToken(account2, key)).toBe("second-secret");

    const [reloaded] = await db
      .select()
      .from(googleOauthAccounts)
      .where(eq(googleOauthAccounts.id, account2.id));
    expect(reloaded).toBeDefined();
    if (reloaded) {
      expect(decryptOauthRefreshToken(reloaded, key)).toBe("second-secret");
    }
  });
});

describe("google/usecase: setCalendarFlags", () => {
  test("setting usedForWrites=true clears it on other calendars in same account", async () => {
    const { accountId } = await seedAccountAndCalendar({ writes: true });
    // Add two more calendars under the same account.
    const [b] = await testDb
      .insert(googleCalendars)
      .values({
        oauthAccountId: accountId,
        googleCalendarId: "b@x.com",
        summary: "b",
        timeZone: "Asia/Tokyo",
        isPrimary: false,
        usedForBusy: true,
        usedForWrites: false,
      })
      .returning();
    const [c] = await testDb
      .insert(googleCalendars)
      .values({
        oauthAccountId: accountId,
        googleCalendarId: "c@x.com",
        summary: "c",
        timeZone: "Asia/Tokyo",
        isPrimary: false,
        usedForBusy: true,
        usedForWrites: false,
      })
      .returning();
    if (!b || !c) throw new Error("seed");

    const updated = await setCalendarFlags(db, b, { usedForWrites: true });
    expect(updated?.usedForWrites).toBe(true);

    // Sibling rows have writes cleared.
    const cReloaded = await findCalendarById(db, c.id);
    expect(cReloaded?.usedForWrites).toBe(false);
  });

  test("setting usedForWrites=false leaves siblings untouched", async () => {
    const { accountId } = await seedAccountAndCalendar({ writes: true });
    const [b] = await testDb
      .insert(googleCalendars)
      .values({
        oauthAccountId: accountId,
        googleCalendarId: "b@x.com",
        summary: "b",
        timeZone: "Asia/Tokyo",
        isPrimary: false,
        usedForBusy: true,
        usedForWrites: true,
      })
      .returning();
    if (!b) throw new Error("seed");

    const updated = await setCalendarFlags(db, b, { usedForWrites: false });
    expect(updated?.usedForWrites).toBe(false);
    // The other (originally writes=true) calendar is NOT modified.
    const list = await db
      .select()
      .from(googleCalendars)
      .where(eq(googleCalendars.oauthAccountId, accountId));
    const stillWrites = list.filter((r) => r.usedForWrites);
    expect(stillWrites.length).toBe(1);
  });

  test("does not affect calendars on a different oauth account", async () => {
    const a = await seedAccountAndCalendar({ writes: true });
    const b = await seedAccountAndCalendar({ writes: true });
    const calA = await findCalendarById(db, a.calendarId);
    if (!calA) throw new Error("seed");
    await setCalendarFlags(db, calA, { usedForWrites: true });
    const reloadedB = await findCalendarById(db, b.calendarId);
    expect(reloadedB?.usedForWrites).toBe(true);
  });

  test("usedForBusy update does not trigger sibling clear", async () => {
    const { accountId } = await seedAccountAndCalendar({ writes: true });
    const [b] = await testDb
      .insert(googleCalendars)
      .values({
        oauthAccountId: accountId,
        googleCalendarId: "b@x.com",
        summary: "b",
        timeZone: "Asia/Tokyo",
        isPrimary: false,
        usedForBusy: true,
        usedForWrites: true,
      })
      .returning();
    if (!b) throw new Error("seed");
    const updated = await setCalendarFlags(db, b, { usedForBusy: false });
    expect(updated?.usedForBusy).toBe(false);
    expect(updated?.usedForWrites).toBe(true);
    // Other writes=true sibling preserved.
    const list = await db
      .select()
      .from(googleCalendars)
      .where(eq(googleCalendars.oauthAccountId, accountId));
    const writesCount = list.filter((r) => r.usedForWrites).length;
    expect(writesCount).toBe(2);
  });
});

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
