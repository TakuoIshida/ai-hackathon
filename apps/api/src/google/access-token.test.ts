import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { googleOauthAccounts } from "@/db/schema/google";
import { createTestDb, type TestDb } from "@/test/integration-db";
// Side-effect import: registers `mock.module("@/lib/http")` swap so SUT modules
// pick up the mocked httpFetch. Must come before any SUT import that
// transitively reaches @/lib/http.
import { httpFetchMock } from "@/test/mock-http";
import { insertUser } from "@/users/repo";
import { getValidAccessToken } from "./access-token";
import type { GoogleConfig } from "./config";
import { upsertOauthAccountWithEncryption } from "./usecase";

let testDb: TestDb;
const ENC_KEY = randomBytes(32);
const cfg: GoogleConfig = {
  clientId: "client-abc.apps.googleusercontent.com",
  clientSecret: "secret-xyz",
  redirectUri: "https://example.com/api/google/callback",
  encryptionKey: ENC_KEY,
  appBaseUrl: "https://example.com",
};

type FetchCall = { url: string; init: RequestInit | undefined };

function installFetch(responder: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  httpFetchMock.mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const call = { url, init };
    calls.push(call);
    return responder(call);
  });
  return { calls };
}

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
    TRUNCATE TABLE google_calendars, google_oauth_accounts, common.users
    RESTART IDENTITY CASCADE;
  `);
  httpFetchMock.mockReset();
});

async function seedAccount(opts: {
  refreshToken?: string;
  accessToken?: string | null;
  expiresAt: Date;
}): Promise<{ userId: string; accountId: string }> {
  const u = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  const account = await upsertOauthAccountWithEncryption(
    db,
    {
      userId: u.id,
      googleUserId: `g_${randomUUID()}`,
      email: "owner@example.com",
      refreshToken: opts.refreshToken ?? "1//refresh-secret",
      accessToken: opts.accessToken ?? "ya29.cached",
      accessTokenExpiresAt: opts.expiresAt,
      scope: "https://www.googleapis.com/auth/calendar.events",
    },
    ENC_KEY,
  );
  // upsertOauthAccountWithEncryption always sets accessToken; if test wants null we override.
  if (opts.accessToken === null) {
    await db
      .update(googleOauthAccounts)
      .set({ accessToken: null })
      .where(eq(googleOauthAccounts.id, account.id));
  }
  return { userId: u.id, accountId: account.id };
}

describe("getValidAccessToken", () => {
  test("returns cached access_token without calling refresh when not near expiry", async () => {
    const { accountId } = await seedAccount({
      accessToken: "ya29.cached",
      expiresAt: new Date(Date.now() + 30 * 60_000), // 30 min ahead
    });
    const { calls } = installFetch(() => {
      throw new Error("fetch should not be called when cached token is valid");
    });

    const token = await getValidAccessToken(db, cfg, accountId);
    expect(token).toBe("ya29.cached");
    expect(calls.length).toBe(0);
  });

  test("refreshes access_token via refresh_token when expired", async () => {
    const { accountId } = await seedAccount({
      refreshToken: "1//valid-refresh",
      accessToken: "ya29.expired",
      expiresAt: new Date(Date.now() - 60_000), // already expired
    });

    const { calls } = installFetch((call) => {
      const body = String(call.init?.body);
      expect(call.url).toBe("https://oauth2.googleapis.com/token");
      expect(body).toContain("grant_type=refresh_token");
      expect(body).toContain("refresh_token=1%2F%2Fvalid-refresh");
      return new Response(
        JSON.stringify({
          access_token: "ya29.fresh",
          expires_in: 3599,
          scope: "https://www.googleapis.com/auth/calendar.events",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const token = await getValidAccessToken(db, cfg, accountId);
    expect(token).toBe("ya29.fresh");
    expect(calls.length).toBe(1);

    // Persisted update
    const [reloaded] = await db
      .select()
      .from(googleOauthAccounts)
      .where(eq(googleOauthAccounts.id, accountId));
    expect(reloaded?.accessToken).toBe("ya29.fresh");
    expect((reloaded?.accessTokenExpiresAt?.getTime() ?? 0) > Date.now()).toBe(true);
  });

  test("refreshes when token is within the leeway window", async () => {
    const { accountId } = await seedAccount({
      refreshToken: "1//leeway-refresh",
      accessToken: "ya29.almost",
      // within 30s leeway → should refresh
      expiresAt: new Date(Date.now() + 5_000),
    });
    installFetch(
      () =>
        new Response(
          JSON.stringify({
            access_token: "ya29.refreshed-leeway",
            expires_in: 3599,
            scope: "https://www.googleapis.com/auth/calendar.events",
          }),
          { status: 200 },
        ),
    );
    const token = await getValidAccessToken(db, cfg, accountId);
    expect(token).toBe("ya29.refreshed-leeway");
  });

  test("throws when refresh_token is invalidated (401 invalid_grant)", async () => {
    const { accountId } = await seedAccount({
      refreshToken: "1//revoked",
      accessToken: "ya29.expired",
      expiresAt: new Date(Date.now() - 60_000),
    });
    installFetch(
      () =>
        new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked." }),
          { status: 401 },
        ),
    );
    await expect(getValidAccessToken(db, cfg, accountId)).rejects.toThrow(/401|invalid_grant/);
  });

  test("throws when oauth account does not exist", async () => {
    await expect(getValidAccessToken(db, cfg, randomUUID())).rejects.toThrow(
      "oauth_account_not_found",
    );
  });

  test("refreshes when no access_token has ever been stored (null)", async () => {
    const { accountId } = await seedAccount({
      refreshToken: "1//never-set",
      accessToken: null,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    installFetch(
      () =>
        new Response(
          JSON.stringify({
            access_token: "ya29.firsttime",
            expires_in: 3599,
            scope: "https://www.googleapis.com/auth/calendar.events",
          }),
          { status: 200 },
        ),
    );
    const token = await getValidAccessToken(db, cfg, accountId);
    expect(token).toBe("ya29.firsttime");
  });
});
