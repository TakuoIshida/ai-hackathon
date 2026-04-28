import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { googleCalendars, googleOauthAccounts, tenants } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import type { CalendarListItem } from "./calendar";
import type { GoogleConfig } from "./config";
import type { GoogleUserInfo, TokenResponse } from "./oauth";
import { findCalendarById, getOauthAccountByUser } from "./repo";
import {
  buildOauthAuthUrl,
  completeOauthCallback,
  decryptOauthRefreshToken,
  disconnectGoogleAccount,
  type OauthSinks,
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

async function seedAccountAndCalendar(opts?: { writes?: boolean }): Promise<{
  userId: string;
  accountId: string;
  calendarId: string;
  tenantId: string;
}> {
  const tenantId = await seedTenant();
  const u = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  const account = await upsertOauthAccountWithEncryption(
    db,
    {
      tenantId,
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
      tenantId,
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
  return { userId: u.id, accountId: account.id, calendarId: cal.id, tenantId };
}

describe("google/usecase: upsertOauthAccountWithEncryption", () => {
  test("encrypts the refresh token and stores ciphertext (round-trip via decryptOauthRefreshToken)", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "x@example.com",
      name: null,
    });
    const refresh = `secret-${randomUUID()}`;
    const key = randomBytes(32);
    const tenantId = await seedTenant();
    const account = await upsertOauthAccountWithEncryption(
      db,
      {
        tenantId,
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
      externalId: `c_${randomUUID()}`,
      email: "y@example.com",
      name: null,
    });
    const googleUserId = `g_${randomUUID()}`;
    const key = randomBytes(32);
    const tenantId = await seedTenant();
    await upsertOauthAccountWithEncryption(
      db,
      {
        tenantId,
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
        tenantId,
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
    const { accountId, tenantId } = await seedAccountAndCalendar({ writes: true });
    // Add two more calendars under the same account.
    const [b] = await testDb
      .insert(googleCalendars)
      .values({
        tenantId,
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
        tenantId,
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
    const { accountId, tenantId } = await seedAccountAndCalendar({ writes: true });
    const [b] = await testDb
      .insert(googleCalendars)
      .values({
        tenantId,
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
    const { accountId, tenantId } = await seedAccountAndCalendar({ writes: true });
    const [b] = await testDb
      .insert(googleCalendars)
      .values({
        tenantId,
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
      externalId: `c_${randomUUID()}`,
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
    const { userId, accountId, calendarId, tenantId } = await seedAccountAndCalendar({
      writes: true,
    });
    const [other] = await testDb
      .insert(googleCalendars)
      .values({
        tenantId,
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

// ---------------------------------------------------------------------------
// OAuth flow usecases (ISH-127)
// ---------------------------------------------------------------------------

const TEST_CFG: GoogleConfig = {
  clientId: "client-abc.apps.googleusercontent.com",
  clientSecret: "secret-xyz",
  redirectUri: "https://example.com/api/google/callback",
  encryptionKey: randomBytes(32),
  appBaseUrl: "https://app.example.com",
};

const okTokens: TokenResponse = {
  accessToken: "ya29.fresh",
  refreshToken: "1//refresh-secret",
  expiresInSeconds: 3599,
  scope: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  ].join(" "),
  idToken: "id-jwt",
};

const okUserInfo: GoogleUserInfo = {
  sub: "g-sub-12345",
  email: "owner@example.com",
  name: "Owner",
};

const okCalendarList: CalendarListItem[] = [
  { id: "primary@example.com", summary: "Primary", primary: true, timeZone: "Asia/Tokyo" },
  { id: "team@example.com", summary: "Team", primary: false, timeZone: "Asia/Tokyo" },
];

type SinkOverrides = Partial<OauthSinks>;

function makeSinks(overrides: SinkOverrides = {}): {
  sinks: OauthSinks;
  calls: {
    exchange: number;
    userinfo: number;
    listCalendars: number;
    syncCalendars: number;
    revoke: string[];
  };
} {
  const calls = {
    exchange: 0,
    userinfo: 0,
    listCalendars: 0,
    syncCalendars: 0,
    revoke: [] as string[],
  };
  const sinks: OauthSinks = {
    exchangeCodeForTokens:
      overrides.exchangeCodeForTokens ??
      (async () => {
        calls.exchange++;
        return okTokens;
      }),
    fetchUserInfo:
      overrides.fetchUserInfo ??
      (async () => {
        calls.userinfo++;
        return okUserInfo;
      }),
    listCalendars:
      overrides.listCalendars ??
      (async () => {
        calls.listCalendars++;
        return okCalendarList;
      }),
    syncCalendars:
      overrides.syncCalendars ??
      (async () => {
        calls.syncCalendars++;
      }),
    revokeToken:
      overrides.revokeToken ??
      (async (token: string) => {
        calls.revoke.push(token);
      }),
  };
  return { sinks, calls };
}

describe("google/usecase: buildOauthAuthUrl", () => {
  test("builds Google consent URL with state and required params", () => {
    const url = new URL(buildOauthAuthUrl(TEST_CFG, "state-token-xyz"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(TEST_CFG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(TEST_CFG.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-token-xyz");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("google/usecase: completeOauthCallback", () => {
  test("invalid_state when cookie/query mismatch", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks, calls } = makeSinks();
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "a", queryState: "b", code: "code-1", userId: u.id, tenantId: "t1" },
      sinks,
    );
    expect(result.kind).toBe("invalid_state");
    // No side effects on bad state
    expect(calls.exchange).toBe(0);
    expect(calls.userinfo).toBe(0);
  });

  test("invalid_state when cookie is missing", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks } = makeSinks();
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: undefined, queryState: "b", code: "code-1", userId: u.id, tenantId: "t1" },
      sinks,
    );
    expect(result.kind).toBe("invalid_state");
  });

  test("missing_code when state matches but code is absent", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks } = makeSinks();
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: undefined, userId: u.id, tenantId: "t1" },
      sinks,
    );
    expect(result.kind).toBe("missing_code");
  });

  test("missing_refresh_token when Google omits refresh_token", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks } = makeSinks({
      exchangeCodeForTokens: async () => ({ ...okTokens, refreshToken: undefined }),
    });
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: "code-1", userId: u.id, tenantId: "t1" },
      sinks,
    );
    expect(result.kind).toBe("missing_refresh_token");
  });

  test("missing_scopes when granted scope set is incomplete", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks } = makeSinks({
      exchangeCodeForTokens: async () => ({ ...okTokens, scope: "openid email" }),
    });
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: "code-1", userId: u.id, tenantId: "t1" },
      sinks,
    );
    expect(result.kind).toBe("missing_scopes");
  });

  test("ok: persists oauth account, runs initial calendar sync, returns redirect URL", async () => {
    const tenantId = await seedTenant();
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks, calls } = makeSinks();
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: "code-1", userId: u.id, tenantId },
      sinks,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.redirectTo).toBe(`${TEST_CFG.appBaseUrl}/dashboard/settings?google_connected=1`);
    expect(result.account.userId).toBe(u.id);
    expect(result.account.googleUserId).toBe(okUserInfo.sub);
    expect(result.account.email).toBe(okUserInfo.email);

    // Side effects fired in order
    expect(calls.exchange).toBe(1);
    expect(calls.userinfo).toBe(1);
    expect(calls.listCalendars).toBe(1);
    expect(calls.syncCalendars).toBe(1);

    // Account row exists in DB
    const stored = await getOauthAccountByUser(db, u.id);
    expect(stored?.googleUserId).toBe(okUserInfo.sub);
  });

  test("ok even when initial calendar sync throws (best-effort)", async () => {
    const tenantId = await seedTenant();
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks } = makeSinks({
      listCalendars: async () => {
        throw new Error("calendarList 503");
      },
    });
    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: "code-1", userId: u.id, tenantId },
      sinks,
    );
    expect(result.kind).toBe("ok");
    // The row is still persisted
    const stored = await getOauthAccountByUser(db, u.id);
    expect(stored?.googleUserId).toBe(okUserInfo.sub);
  });

  test("upsert: re-running callback for the same google user updates the row", async () => {
    const tenantId = await seedTenant();
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks: s1 } = makeSinks();
    const r1 = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: "code-1", userId: u.id, tenantId },
      s1,
    );
    expect(r1.kind).toBe("ok");

    const { sinks: s2 } = makeSinks({
      exchangeCodeForTokens: async () => ({
        ...okTokens,
        accessToken: "ya29.second",
        refreshToken: "1//refresh-second",
      }),
    });
    const r2 = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s2", queryState: "s2", code: "code-2", userId: u.id, tenantId },
      s2,
    );
    expect(r2.kind).toBe("ok");

    // Still exactly one row
    const rows = await testDb.select().from(googleOauthAccounts);
    expect(rows.filter((r) => r.userId === u.id).length).toBe(1);
    const reloaded = await getOauthAccountByUser(db, u.id);
    expect(reloaded?.accessToken).toBe("ya29.second");
  });
});

describe("google/usecase: disconnectGoogleAccount", () => {
  test("already_disconnected when no oauth row exists", async () => {
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    const { sinks, calls } = makeSinks();
    const result = await disconnectGoogleAccount(db, TEST_CFG, u.id, sinks);
    expect(result.kind).toBe("already_disconnected");
    expect(calls.revoke.length).toBe(0);
  });

  test("ok: revokes refresh token and deletes the row", async () => {
    const tenantId = await seedTenant();
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    await upsertOauthAccountWithEncryption(
      db,
      {
        tenantId,
        userId: u.id,
        googleUserId: `g_${randomUUID()}`,
        email: "u@example.com",
        refreshToken: "1//to-be-revoked",
        accessToken: "ya29.x",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "openid email",
      },
      TEST_CFG.encryptionKey,
    );
    const { sinks, calls } = makeSinks();

    const result = await disconnectGoogleAccount(db, TEST_CFG, u.id, sinks);
    expect(result.kind).toBe("ok");
    // The decrypted refresh token was passed to revoke
    expect(calls.revoke).toEqual(["1//to-be-revoked"]);
    // Row is gone
    const reloaded = await getOauthAccountByUser(db, u.id);
    expect(reloaded).toBeNull();
  });

  test("ok: still deletes row when revoke throws (best-effort)", async () => {
    const tenantId = await seedTenant();
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });
    await upsertOauthAccountWithEncryption(
      db,
      {
        tenantId,
        userId: u.id,
        googleUserId: `g_${randomUUID()}`,
        email: "u@example.com",
        refreshToken: "1//flaky",
        accessToken: "ya29.x",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: "openid email",
      },
      TEST_CFG.encryptionKey,
    );
    const { sinks } = makeSinks({
      revokeToken: async () => {
        throw new Error("Google revoke 500");
      },
    });

    const result = await disconnectGoogleAccount(db, TEST_CFG, u.id, sinks);
    expect(result.kind).toBe("ok");
    const reloaded = await getOauthAccountByUser(db, u.id);
    expect(reloaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E2E-style: drive the full callback flow with a fake fetch wired through the
// REAL oauth/calendar modules. Proves the ports adapter contract holds and
// guards against regressions in the URL contract or response mapping.
// ---------------------------------------------------------------------------
describe("google/usecase: completeOauthCallback (real adapters + fake fetch)", () => {
  test("token exchange + userinfo + calendarList all wired correctly", async () => {
    const tenantId = await seedTenant();
    const u = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u@example.com",
      name: null,
    });

    const seenUrls: string[] = [];
    const fakeFetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      seenUrls.push(url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "ya29.real",
            refresh_token: "1//real-refresh",
            expires_in: 3599,
            scope: okTokens.scope,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) {
        return new Response(JSON.stringify(okUserInfo), { status: 200 });
      }
      if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "primary@example.com",
                summary: "Primary",
                primary: true,
                timeZone: "Asia/Tokyo",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    // Wire the real adapters but route every fetch through the fake.
    const oauthMod = await import("./oauth");
    const calMod = await import("./calendar");
    const repoMod = await import("./repo");
    const sinks: OauthSinks = {
      exchangeCodeForTokens: (cfg, code) => oauthMod.exchangeCodeForTokens(cfg, code, fakeFetch),
      fetchUserInfo: (token) => oauthMod.fetchUserInfo(token, fakeFetch),
      revokeToken: (token) => oauthMod.revokeToken(token, fakeFetch),
      listCalendars: (token) => calMod.listCalendars(token, fakeFetch),
      syncCalendars: repoMod.syncCalendars,
    };

    const result = await completeOauthCallback(
      db,
      TEST_CFG,
      { cookieState: "s", queryState: "s", code: "code-real", userId: u.id, tenantId },
      sinks,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(seenUrls.some((u) => u.startsWith("https://oauth2.googleapis.com/token"))).toBe(true);
    expect(
      seenUrls.some((u) => u.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")),
    ).toBe(true);
    expect(
      seenUrls.some((u) =>
        u.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList"),
      ),
    ).toBe(true);

    const stored = await getOauthAccountByUser(db, u.id);
    expect(stored?.accessToken).toBe("ya29.real");

    // Calendar row was synced
    const cals = await testDb.select().from(googleCalendars);
    expect(cals.find((c) => c.googleCalendarId === "primary@example.com")).toBeTruthy();
  });
});
