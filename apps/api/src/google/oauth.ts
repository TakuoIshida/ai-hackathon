import { type FetchLike, httpFetch } from "@/lib/http";

export type OauthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  scope: string;
  idToken?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

export const REQUIRED_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export function buildAuthUrl(config: OauthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type RawTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  token_type?: string;
};

function mapTokenResponse(raw: RawTokenResponse): TokenResponse {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresInSeconds: raw.expires_in,
    scope: raw.scope,
    idToken: raw.id_token,
  };
}

async function postForm(
  url: string,
  body: Record<string, string>,
  fetchImpl: FetchLike = httpFetch,
): Promise<RawTokenResponse> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth ${res.status}: ${text}`);
  }
  return (await res.json()) as RawTokenResponse;
}

export async function exchangeCodeForTokens(
  config: OauthConfig,
  code: string,
  fetchImpl?: FetchLike,
): Promise<TokenResponse> {
  const raw = await postForm(
    GOOGLE_TOKEN_URL,
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
  return mapTokenResponse(raw);
}

export async function refreshAccessToken(
  config: OauthConfig,
  refreshToken: string,
  fetchImpl?: FetchLike,
): Promise<TokenResponse> {
  const raw = await postForm(
    GOOGLE_TOKEN_URL,
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  return mapTokenResponse(raw);
}

export async function revokeToken(token: string, fetchImpl: FetchLike = httpFetch): Promise<void> {
  const res = await fetchImpl(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
  if (!res.ok && res.status !== 400) {
    const text = await res.text();
    throw new Error(`Google revoke ${res.status}: ${text}`);
  }
}

export async function fetchUserInfo(
  accessToken: string,
  fetchImpl: FetchLike = httpFetch,
): Promise<GoogleUserInfo> {
  const res = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google userinfo ${res.status}: ${text}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

export function hasRequiredScopes(grantedScope: string): boolean {
  const granted = new Set(grantedScope.split(/\s+/));
  return REQUIRED_SCOPES.every((s) => granted.has(s));
}
