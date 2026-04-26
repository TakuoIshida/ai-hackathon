import { loadEncryptionKey } from "./crypto";

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
  appBaseUrl: string;
};

export function loadGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  const appBaseUrl = env.APP_BASE_URL ?? "http://localhost:6173";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI must be set",
    );
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey: loadEncryptionKey(env.ENCRYPTION_KEY),
    appBaseUrl,
  };
}
