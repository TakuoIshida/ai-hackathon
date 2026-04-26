import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { loadGoogleConfig } from "./config";

const validKey = randomBytes(32).toString("base64");

describe("loadGoogleConfig", () => {
  test("loads config from env", () => {
    const cfg = loadGoogleConfig({
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://api.example.com/google/callback",
      APP_BASE_URL: "https://app.example.com",
      ENCRYPTION_KEY: validKey,
    } as NodeJS.ProcessEnv);
    expect(cfg.clientId).toBe("id");
    expect(cfg.clientSecret).toBe("secret");
    expect(cfg.redirectUri).toBe("https://api.example.com/google/callback");
    expect(cfg.appBaseUrl).toBe("https://app.example.com");
    expect(cfg.encryptionKey.length).toBe(32);
  });

  test("defaults appBaseUrl when not set", () => {
    const cfg = loadGoogleConfig({
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://x/cb",
      ENCRYPTION_KEY: validKey,
    } as NodeJS.ProcessEnv);
    expect(cfg.appBaseUrl).toBe("http://localhost:6173");
  });

  test("throws when OAuth env missing", () => {
    expect(() => loadGoogleConfig({ ENCRYPTION_KEY: validKey } as NodeJS.ProcessEnv)).toThrow();
  });

  test("throws when ENCRYPTION_KEY missing", () => {
    expect(() =>
      loadGoogleConfig({
        GOOGLE_OAUTH_CLIENT_ID: "id",
        GOOGLE_OAUTH_CLIENT_SECRET: "secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://x/cb",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
