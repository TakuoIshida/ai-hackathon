import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { googleCalendars, tenants } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import {
  clearWritesFlagOnSiblings,
  findCalendarById,
  listUserCalendars,
  updateCalendarFlagsRow,
  upsertOauthAccountRaw,
} from "./repo";

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
    TRUNCATE TABLE tenant.google_calendars, tenant.google_oauth_accounts,
    common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedTenant(): Promise<string> {
  const [tenant] = await testDb.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed: tenant insert failed");
  return tenant.id;
}

async function seedAccount(): Promise<{ userId: string; accountId: string; tenantId: string }> {
  const tenantId = await seedTenant();
  const u = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  const account = await upsertOauthAccountRaw(db, {
    tenantId,
    userId: u.id,
    googleUserId: `g_${randomUUID()}`,
    email: "owner@example.com",
    encryptedRefreshToken: "ct",
    refreshTokenIv: "iv",
    refreshTokenAuthTag: "tag",
    accessToken: "access-test",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    scope: "calendar.events",
  });
  return { userId: u.id, accountId: account.id, tenantId };
}

async function seedCalendar(
  accountId: string,
  tenantId: string,
  googleCalendarId: string,
  flags: { isPrimary?: boolean; usedForBusy?: boolean; usedForWrites?: boolean } = {},
) {
  const [row] = await testDb
    .insert(googleCalendars)
    .values({
      tenantId,
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

describe("google/repo: updateCalendarFlagsRow", () => {
  test("updates usedForBusy without touching usedForWrites", async () => {
    const { accountId, tenantId } = await seedAccount();
    const cal = await seedCalendar(accountId, tenantId, "primary@a.com", {
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: true,
    });

    await updateCalendarFlagsRow(db, cal.id, { usedForBusy: false });
    const reloaded = await findCalendarById(db, cal.id);
    expect(reloaded?.usedForBusy).toBe(false);
    expect(reloaded?.usedForWrites).toBe(true);
  });

  test("updates usedForWrites without touching siblings (single-row only)", async () => {
    const { accountId, tenantId } = await seedAccount();
    const a = await seedCalendar(accountId, tenantId, "a@x.com", { usedForWrites: true });
    const b = await seedCalendar(accountId, tenantId, "b@x.com", { usedForWrites: false });

    await updateCalendarFlagsRow(db, b.id, { usedForWrites: true });
    const aReloaded = await findCalendarById(db, a.id);
    const bReloaded = await findCalendarById(db, b.id);
    // repo primitive does NOT enforce exclusivity — both can be true here.
    expect(aReloaded?.usedForWrites).toBe(true);
    expect(bReloaded?.usedForWrites).toBe(true);
  });

  test("update bumps updatedAt", async () => {
    const { accountId, tenantId } = await seedAccount();
    const cal = await seedCalendar(accountId, tenantId, "x@a.com");
    const before = cal.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await updateCalendarFlagsRow(db, cal.id, { usedForBusy: false });
    const [reloaded] = await testDb
      .select()
      .from(googleCalendars)
      .where(eq(googleCalendars.id, cal.id));
    expect(reloaded?.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe("google/repo: clearWritesFlagOnSiblings", () => {
  test("clears usedForWrites on every calendar in the same account except the target", async () => {
    const { accountId, tenantId } = await seedAccount();
    const a = await seedCalendar(accountId, tenantId, "a@x.com", { usedForWrites: true });
    const b = await seedCalendar(accountId, tenantId, "b@x.com", { usedForWrites: true });
    const c = await seedCalendar(accountId, tenantId, "c@x.com", { usedForWrites: true });

    await clearWritesFlagOnSiblings(db, accountId, b.id);

    const aReloaded = await findCalendarById(db, a.id);
    const bReloaded = await findCalendarById(db, b.id);
    const cReloaded = await findCalendarById(db, c.id);
    expect(aReloaded?.usedForWrites).toBe(false);
    expect(bReloaded?.usedForWrites).toBe(true); // target preserved
    expect(cReloaded?.usedForWrites).toBe(false);
  });

  test("does not affect calendars on a different oauth account", async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    const calA = await seedCalendar(accountA.accountId, accountA.tenantId, "x@a.com", {
      usedForWrites: true,
    });
    const calB = await seedCalendar(accountB.accountId, accountB.tenantId, "x@b.com", {
      usedForWrites: true,
    });

    await clearWritesFlagOnSiblings(db, accountA.accountId, calA.id);
    const reloadedB = await findCalendarById(db, calB.id);
    expect(reloadedB?.usedForWrites).toBe(true);
  });
});

describe("google/repo: queries", () => {
  test("findCalendarById returns null for missing", async () => {
    expect(await findCalendarById(db, randomUUID())).toBeNull();
  });

  test("listUserCalendars returns rows for the given account only", async () => {
    const { accountId, tenantId } = await seedAccount();
    await seedCalendar(accountId, tenantId, "x@a.com");
    await seedCalendar(accountId, tenantId, "y@a.com");
    const list = await listUserCalendars(db, accountId);
    expect(list.length).toBe(2);
  });
});
