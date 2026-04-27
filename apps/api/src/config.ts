// ISH-128: single source of truth for environment configuration.
//
// Production startup goes through `assertProductionConfig()` (called from
// `index.ts`) so missing env vars surface immediately at boot rather than at
// first request. Lower layers (routes / jobs) import the frozen `config`
// singleton instead of reading `process.env` directly — this keeps env access
// out of the route handlers themselves and lets tests rely on the `[test]
// preload` bunfig stubs without sprinkling `??=` preludes around.
//
// `usecase.ts` / `repo.ts` continue to never read env directly: per-call
// configuration is passed in as a typed dependency (`GoogleConfig`,
// `ClerkPort`, `SendEmailFn`, etc.) — `config.ts` is consumed only by route
// factories and jobs.
import { type GoogleConfig, loadGoogleConfig } from "@/google/config";
import { loadResendConfig, type ResendConfig } from "@/notifications/sender";

export type AppConfig = {
  port: number;
  nodeEnv: string;
  /** True iff `NODE_ENV === "production"`. Used for `Secure` cookie etc. */
  isProduction: boolean;
  appBaseUrl: string;
  databaseUrl: string | undefined;
  clerkSecretKey: string | undefined;
  clerkWebhookSecret: string | undefined;
  /** Null when any of the 3 GOOGLE_OAUTH_* env vars are missing. */
  google: GoogleConfig | null;
  /** Null when RESEND_API_KEY or EMAIL_FROM is missing. */
  resend: ResendConfig | null;
};

function tryLoadGoogle(env: NodeJS.ProcessEnv): GoogleConfig | null {
  try {
    return loadGoogleConfig(env);
  } catch {
    // loadGoogleConfig throws when any of the 3 OAuth env vars are missing.
    // In dev / tests that's normal; we surface the missing config as `null`
    // and downstream code (route deps + computePublicSlots) treats it as
    // "Google sync disabled".
    return null;
  }
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8787),
    nodeEnv: env.NODE_ENV ?? "development",
    isProduction: env.NODE_ENV === "production",
    appBaseUrl: env.APP_BASE_URL ?? "http://localhost:6173",
    databaseUrl: env.DATABASE_URL,
    clerkSecretKey: env.CLERK_SECRET_KEY,
    clerkWebhookSecret: env.CLERK_WEBHOOK_SECRET,
    google: tryLoadGoogle(env),
    resend: loadResendConfig(env),
  };
}

/**
 * Module-level singleton, populated at module load. Module-level eagerness is
 * fine because `loadAppConfig` only reads env (no I/O, no validation throws).
 * Validation happens explicitly via `assertProductionConfig()` so tests can
 * import this module without setting every required env var.
 *
 * NOT frozen by design: tests need to mutate it after module load (e.g. the
 * clerk-webhook test sets a known-good secret in `beforeAll`). Use
 * `setConfigForTests` so the override is explicit, paired with a restore in
 * `afterAll`.
 */
export const config: AppConfig = loadAppConfig();

/**
 * Test escape hatch — mirrors `setDbForTests`. Mutates the singleton so any
 * already-imported route handler picks up the new value next time it reads.
 * Returns a snapshot of the previous values so the test can restore in
 * `afterAll` / `afterEach` to avoid cross-test pollution.
 */
export function setConfigForTests(overrides: Partial<AppConfig>): Partial<AppConfig> {
  const prev: Partial<AppConfig> = {};
  for (const key of Object.keys(overrides) as (keyof AppConfig)[]) {
    (prev as Record<string, unknown>)[key] = config[key];
    (config as Record<string, unknown>)[key] = overrides[key];
  }
  return prev;
}

/**
 * Throws if any production-required env is missing. Called from `index.ts`
 * (the binary entrypoint) so the process dies at boot rather than at the
 * first request that hits one of these code paths. Tests skip this — they
 * never run `index.ts` and use `setDbForTests` + Clerk stub middleware.
 */
export function assertProductionConfig(c: AppConfig = config): void {
  const missing: string[] = [];
  if (!c.databaseUrl) missing.push("DATABASE_URL");
  if (!c.clerkSecretKey) missing.push("CLERK_SECRET_KEY");
  if (!c.clerkWebhookSecret) missing.push("CLERK_WEBHOOK_SECRET");
  if (missing.length > 0) {
    throw new Error(`[config] missing required env: ${missing.join(", ")}`);
  }
}
