import { describe, expect, test } from "bun:test";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  hasRequiredScopes,
  REQUIRED_SCOPES,
  refreshAccessToken,
  revokeToken,
} from "./oauth";

const config = {
  clientId: "client-abc.apps.googleusercontent.com",
  clientSecret: "secret-xyz",
  redirectUri: "https://example.com/api/google/callback",
};

type FetchCall = { url: string; init: RequestInit | undefined };
const recordingFetch = (
  responder: (call: FetchCall) => Response,
): {
  fetch: typeof fetch;
  calls: FetchCall[];
} => {
  const calls: FetchCall[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const call = { url, init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
};

describe("buildAuthUrl", () => {
  test("includes required parameters and scopes", () => {
    const url = new URL(buildAuthUrl(config, "state-token-123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-token-123");
    const scope = url.searchParams.get("scope") ?? "";
    for (const s of REQUIRED_SCOPES) expect(scope).toContain(s);
  });
});

describe("exchangeCodeForTokens", () => {
  test("posts form-encoded body and maps response", async () => {
    const { fetch: f, calls } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({
            access_token: "ya29.token",
            refresh_token: "1//refresh",
            expires_in: 3599,
            scope: REQUIRED_SCOPES.join(" "),
            token_type: "Bearer",
            id_token: "id-jwt",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const tokens = await exchangeCodeForTokens(config, "auth-code-1", f);
    expect(tokens).toEqual({
      accessToken: "ya29.token",
      refreshToken: "1//refresh",
      expiresInSeconds: 3599,
      scope: REQUIRED_SCOPES.join(" "),
      idToken: "id-jwt",
    });
    const call = calls[0];
    expect(call?.url).toBe("https://oauth2.googleapis.com/token");
    expect(call?.init?.method).toBe("POST");
    const body = String(call?.init?.body);
    expect(body).toContain("code=auth-code-1");
    expect(body).toContain(`client_id=${encodeURIComponent(config.clientId)}`);
    expect(body).toContain("grant_type=authorization_code");
  });

  test("throws on non-2xx", async () => {
    const { fetch: f } = recordingFetch(() => new Response("invalid_grant", { status: 400 }));
    await expect(exchangeCodeForTokens(config, "bad", f)).rejects.toThrow(/400/);
  });
});

describe("refreshAccessToken", () => {
  test("uses refresh_token grant", async () => {
    const { fetch: f, calls } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({
            access_token: "ya29.refreshed",
            expires_in: 3599,
            scope: REQUIRED_SCOPES.join(" "),
          }),
          { status: 200 },
        ),
    );
    const tokens = await refreshAccessToken(config, "1//refresh", f);
    expect(tokens.accessToken).toBe("ya29.refreshed");
    expect(tokens.refreshToken).toBeUndefined();
    const body = String(calls[0]?.init?.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("refresh_token=1%2F%2Frefresh");
  });
});

describe("revokeToken", () => {
  test("posts to revoke endpoint and tolerates 400", async () => {
    const { fetch: f, calls } = recordingFetch(() => new Response("", { status: 400 }));
    await revokeToken("token-x", f);
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(calls[0]?.init?.body)).toContain("token=token-x");
  });
});

describe("fetchUserInfo", () => {
  test("includes Bearer auth and parses sub/email", async () => {
    const { fetch: f, calls } = recordingFetch(
      () =>
        new Response(JSON.stringify({ sub: "g-1", email: "u@example.com", name: "U" }), {
          status: 200,
        }),
    );
    const info = await fetchUserInfo("ya29.x", f);
    expect(info.sub).toBe("g-1");
    expect(info.email).toBe("u@example.com");
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer ya29.x",
    );
  });
});

describe("hasRequiredScopes", () => {
  test("true when all required scopes are granted", () => {
    expect(hasRequiredScopes(REQUIRED_SCOPES.join(" "))).toBe(true);
  });
  test("false when a calendar scope is missing", () => {
    const missing = REQUIRED_SCOPES.filter((s) => !s.includes("calendar.events")).join(" ");
    expect(hasRequiredScopes(missing)).toBe(false);
  });
});
