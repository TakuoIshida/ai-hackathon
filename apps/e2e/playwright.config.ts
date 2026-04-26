import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

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
    },
    {
      // In CI, the web build artifact is downloaded into apps/web/dist by the
      // workflow before this server starts, so we serve the production bundle
      // via `vite preview` instead of running a fresh dev build per shard.
      command: isCI ? "bun run --filter @app/web preview" : "bun run --filter @app/web dev",
      url: "http://localhost:6173",
      cwd: "../..",
      reuseExistingServer: !isCI,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
