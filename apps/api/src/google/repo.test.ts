import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { googleCalendars } from "@/db/schema/google";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import {
  findCalendarById,
  listUserCalendars,
  updateCalendarFlags,
  upsertOauthAccount,
} from "./repo";

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

async function seedAccount(): Promise<{ userId: string; accountId: string }> {
  const u = await insertUser(db, {
    clerkId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  const account = await upsertOauthAccount(db, {
    userId: u.id,
    googleUserId: `g_${randomUUID()}`,
    email: "owner@example.com",
    refreshToken: "refresh-test",
    accessToken: "access-test",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    scope: "calendar.events",
    encryptionKey: ENC_KEY,
  });
  return { userId: u.id, accountId: account.id };
}

async function seedCalendar(
  accountId: string,
  googleCalendarId: string,
  flags: { isPrimary?: boolean; usedForBusy?: boolean; usedForWrites?: boolean } = {},
) {
  const [row] = await testDb
    .insert(googleCalendars)
    .values({
      oauthAccountId: accountId,
      googleCalendarId,
      summary: googleCalendarId,
      timeZone: "Asia/Tokyo",
      isPrimary: flags.isPrimary ?? false,
      usedForBusy: flags.usedForBusy ?? true,
      usedForWrites: flags.usedForWrites ?? false,
    })
    .returning();
  if (!row) throw new Error("seed: calendar insert failed");
  return row;
}

describe("google/repo: updateCalendarFlags", () => {
  test("updates usedForBusy without touching usedForWrites", async () => {
    const { accountId } = await seedAccount();
    const cal = await seedCalendar(accountId, "primary@a.com", {
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: true,
    });

    const updated = await updateCalendarFlags(db, cal, { usedForBusy: false });
    expect(updated?.usedForBusy).toBe(false);
    expect(updated?.usedForWrites).toBe(true);
  });

  test("setting usedForWrites=true clears it on other calendars in same account", async () => {
    const { accountId } = await seedAccount();
    const a = await seedCalendar(accountId, "a@x.com", { usedForWrites: true });
    const b = await seedCalendar(accountId, "b@x.com", { usedForWrites: false });
    const c = await seedCalendar(accountId, "c@x.com", { usedForWrites: false });

    const updated = await updateCalendarFlags(db, b, { usedForWrites: true });
    expect(updated?.usedForWrites).toBe(true);

    const aReloaded = await findCalendarById(db, a.id);
    const cReloaded = await findCalendarById(db, c.id);
    expect(aReloaded?.usedForWrites).toBe(false);
    expect(cReloaded?.usedForWrites).toBe(false);
  });

  test("setting usedForWrites=false leaves other calendars untouched", async () => {
    const { accountId } = await seedAccount();
    const a = await seedCalendar(accountId, "a@x.com", { usedForWrites: false });
    const b = await seedCalendar(accountId, "b@x.com", { usedForWrites: true });

    const updated = await updateCalendarFlags(db, b, { usedForWrites: false });
    expect(updated?.usedForWrites).toBe(false);
    const aReloaded = await findCalendarById(db, a.id);
    expect(aReloaded?.usedForWrites).toBe(false);
  });

  test("does not affect calendars on a different oauth account", async () => {
    const { accountId: accountA } = await seedAccount();
    const { accountId: accountB } = await seedAccount();
    const calA = await seedCalendar(accountA, "x@a.com", { usedForWrites: true });
    const calB = await seedCalendar(accountB, "x@b.com", { usedForWrites: true });

    await updateCalendarFlags(db, calA, { usedForWrites: true });
    const reloadedB = await findCalendarById(db, calB.id);
    expect(reloadedB?.usedForWrites).toBe(true);
  });

  test("findCalendarById returns null for missing", async () => {
    expect(await findCalendarById(db, randomUUID())).toBeNull();
  });

  test("listUserCalendars returns rows for the given account only", async () => {
    const { accountId } = await seedAccount();
    await seedCalendar(accountId, "x@a.com");
    await seedCalendar(accountId, "y@a.com");
    const list = await listUserCalendars(db, accountId);
    expect(list.length).toBe(2);
  });

  test("update bumps updatedAt", async () => {
    const { accountId } = await seedAccount();
    const cal = await seedCalendar(accountId, "x@a.com");
    const before = cal.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await updateCalendarFlags(db, cal, { usedForBusy: false });
    const [reloaded] = await testDb
      .select()
      .from(googleCalendars)
      .where(eq(googleCalendars.id, cal.id));
    expect(reloaded && reloaded.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });
});
