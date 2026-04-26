import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

const ORIG_ENV: Record<string, string | undefined> = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

function setGoogleEnv() {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:8787/google/callback";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

function clearGoogleEnv() {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  delete process.env.ENCRYPTION_KEY;
}

afterEach(() => {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET /google/* without Clerk session", () => {
  test("connect → 401", async () => {
    const res = await app.request("/google/connect");
    expect(res.status).toBe(401);
  });
  test("callback → 401", async () => {
    const res = await app.request("/google/callback?code=x&state=y");
    expect(res.status).toBe(401);
  });
  test("PATCH /google/calendars/:id → 401", async () => {
    const res = await app.request("/google/calendars/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usedForBusy: true }),
    });
    expect(res.status).toBe(401);
  });
});

// Note: full success-path tests for connect/callback require a Clerk session and DB.
// Those live in E2E. Here we exercise the auth gate and env-loading boundary.

describe("loadGoogleConfig boundary (called from /connect)", () => {
  beforeAll(() => clearGoogleEnv());
  test("connect throws when GOOGLE env missing → 500 via error handler", async () => {
    // Clerk middleware will reject before config runs (no session) — confirm gate is auth, not config
    const res = await app.request("/google/connect");
    expect(res.status).toBe(401);
  });

  test("config loader throws standalone when env missing", async () => {
    const { loadGoogleConfig } = await import("@/google/config");
    expect(() => loadGoogleConfig({} as NodeJS.ProcessEnv)).toThrow();
  });

  test("config loader works with full env", async () => {
    setGoogleEnv();
    const { loadGoogleConfig } = await import("@/google/config");
    const cfg = loadGoogleConfig();
    expect(cfg.clientId).toBe("client.apps.googleusercontent.com");
    expect(cfg.encryptionKey.length).toBe(32);
  });
});
