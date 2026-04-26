/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import styleX from "vite-plugin-stylex";

// E2E-only Clerk bypass. When VITE_E2E_BYPASS_AUTH=1 is set on the build/dev
// command (apps/e2e/playwright.config.ts), every import of @clerk/clerk-react
// resolves to a stub that treats the user as signed-in. Production builds do
// not set this env, so the alias is inert.
const e2eBypassAuth = process.env.VITE_E2E_BYPASS_AUTH === "1";

export default defineConfig({
  plugins: [react(), styleX()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...(e2eBypassAuth
        ? { "@clerk/clerk-react": path.resolve(__dirname, "./src/test/clerk-e2e-shim.tsx") }
        : {}),
    },
  },
  server: {
    port: 6173,
  },
  preview: {
    port: 6173,
    strictPort: true,
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/components/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.stylex.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
