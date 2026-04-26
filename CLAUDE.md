# CLAUDE.md

Conventions and guardrails for AI agents (Claude, Copilot, etc.) working in
this repo. Human contributor docs live in `README.md`; this file captures the
rules that are easy to get wrong when generating code automatically.

## Test file placement

**These rules apply to new files only. Existing files are not relocated.**

Five categories cover everything we write today:

- **Unit / integration tests** — colocated side-by-side with the file under
  test as `*.test.ts` / `*.test.tsx`. Example:
  `apps/api/src/bookings/repo.test.ts` sits next to `repo.ts`. Both `bun test`
  (api) and Vitest (web) auto-discover this pattern, so no extra config is
  needed when you add a new test.
- **Test helpers / fixtures** — put shared helpers under
  `apps/<workspace>/src/test/`. Example:
  `apps/api/src/test/integration-db.ts` (PGlite + migration loader used by
  every repo test).
- **E2E shims / mocks consumed by app builds** — also under
  `apps/<workspace>/src/test/`, so they live inside the workspace's TS
  project but are clearly segregated from production modules. Example:
  `apps/web/src/test/clerk-e2e-shim.tsx` (aliased in via `vite.config.ts`
  when `VITE_E2E_BYPASS_AUTH=1`).
- **Production adapters (port implementations)** — these are NOT test files,
  even though they sit at a seam that's easy to confuse with one. Place them
  under the feature directory next to the usecase they back. Example:
  `apps/api/src/users/clerk-port.ts` lives next to `usecase.ts` and
  `domain.ts`. Do not put them under `src/test/`.
- **End-to-end specs (Playwright)** — `apps/e2e/tests/*.spec.ts`. The e2e
  workspace is the only place Playwright specs live; do not put `*.spec.ts`
  inside `apps/web` or `apps/api`.

### Why this layout

- Sidecar `*.test.ts` keeps cognitive distance between a unit and its tests
  to zero, and Bun / Vitest both default to it.
- A single `src/test/` directory per workspace means "anything under here is
  not shipped" is a one-line mental model — but it stays inside `src/` so
  the existing `tsconfig.include = ["src"]` covers it without extra globs.
- Production adapters (e.g. `clerk-port.ts`) ARE shipped, so they belong in
  the feature directory. Putting them in `src/test/` would mislead readers
  and complicate any future production-only TS project.
- E2E specs use a separate workspace (`apps/e2e`) with its own `tsconfig`
  and Playwright runner, so keeping them out of app workspaces avoids
  doubling up TypeScript includes and test runners.

### Config alignment (verified)

The current toolchain already matches the rules above; new files dropped in
the right place need no further wiring:

- `apps/api/tsconfig.json` — `"include": ["src", "drizzle.config.ts"]`
  picks up both `src/**/*.test.ts` and `src/test/**`.
- `apps/api` test runner — `"test": "bun test"` auto-discovers
  `**/*.test.ts` under `src/`.
- `apps/web/tsconfig.app.json` — `"include": ["src"]` picks up sidecar
  `*.test.tsx` and `src/test/**`.
- `apps/web/vite.config.ts` — Vitest config is inlined; the test glob is
  `include: ["src/**/*.{test,spec}.{ts,tsx}"]` and `setupFiles` points at
  `./src/test/setup.ts`. There is no separate `vitest.config.ts`.
- `apps/e2e/tsconfig.json` — `"include": ["tests", "playwright.config.ts"]`
  scopes the Playwright TS project to `tests/*.spec.ts`.

If you introduce a new workspace, mirror the same layout: sidecar tests +
`src/test/` for shared helpers, with `tsconfig.include` pointed at `src`.
