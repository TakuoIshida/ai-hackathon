import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

// E2E env that the web dev/preview server inherits. We always run with the
// Clerk bypass so dashboard routes render without exercising real OAuth, and
// we set a placeholder publishable key so any code that still gates on
// HAS_CLERK (e.g. the landing's sign-in CTA) takes the "Clerk-enabled" path.
//
// VITE_E2E_BYPASS_AUTH=1 is wired up in apps/web/vite.config.ts as a
// resolve.alias that swaps @clerk/clerk-react for a local shim. The shim
// reports the user as signed-in so <SignedIn>/<SignedOut> render correctly,
// and useAuth().getToken() returns a no-op string. Network calls are still
// mocked at the page level via page.route().
const webEnv = {
  VITE_E2E_BYPASS_AUTH: "1",
  VITE_CLERK_PUBLISHABLE_KEY: "pk_test_e2e_bypass",
  // Point the web bundle at a deterministic API URL even though we mock all
  // /links, /bookings, /public, /me responses with page.route(). This keeps
  // the requests easy to match (host-agnostic globs in tests still work).
  VITE_API_URL: "http://localhost:8787",
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["blob"]] : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:6173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Auto-start the api + web dev servers from repo root.
  // cwd defaults to the directory of this config file (apps/e2e), so "../.."
  // walks back up to the repo root where the bun workspace scripts live.
  webServer: [
    {
      command: "bun run --filter @app/api dev",
      url: "http://localhost:8787/health",
      cwd: "../..",
      reuseExistingServer: !isCI,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
      // E2E specs mock all API calls via page.route(); the API process only
      // needs to boot far enough to serve /health. ISH-128's
      // assertProductionConfig() throws at boot when these are missing, so we
      // feed dummy values here. None of these are dialed — DATABASE_URL is
      // never connected to, the Clerk keys never authenticate.
      env: {
        DATABASE_URL: "postgres://e2e:e2e@localhost:5432/e2e",
        CLERK_SECRET_KEY: "sk_test_e2e_bypass",
        CLERK_WEBHOOK_SECRET: "whsec_e2e_bypass",
      },
    },
    {
      // In CI the web build artifact is downloaded into apps/web/dist by the
      // workflow, but that artifact was produced WITHOUT the E2E auth bypass
      // (the build job is shared with the deploy path). To guarantee dashboard
      // routes are reachable, the e2e step rebuilds with VITE_E2E_BYPASS_AUTH=1
      // set, then runs `vite preview`. See .github/workflows/ci.yml.
      command: isCI
        ? "bun run --filter @app/web build && bun run --filter @app/web preview"
        : "bun run --filter @app/web dev",
      url: "http://localhost:6173",
      cwd: "../..",
      reuseExistingServer: !isCI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: webEnv,
    },
  ],
});
