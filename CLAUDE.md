# CLAUDE.md

Conventions and guardrails for AI agents (Claude, Copilot, etc.) working in
this repo. Human contributor docs live in `README.md`; this file captures the
rules that are easy to get wrong when generating code automatically.

## Multi-tenant 規約

This repo is multi-tenant. Tenant 分離は **RLS (Row Level Security)** で強制
されており、application コードからは暗黙に効きます。新規スキーマ・テーブル・
認証コードを書くときに守るべき規約をここに集約します。設計の詳細は
`docs/design/` 配下を参照。

### Schema 配置 (common / tenant)

- **common schema** — tenant 横断で参照される 3 テーブルのみ
  - `users`, `tenants`, `tenant_members`
  - RLS 対象外 (login 解決前は tenant_id を絞れないため)
- **tenant schema** — 業務データすべて
  - 新規追加テーブルは原則 tenant schema に置く
  - 全テーブルに `tenant_id text NOT NULL REFERENCES common.tenants(id)` を
    必須

現状の割り振りは [`docs/design/schema-map.md`](docs/design/schema-map.md)。

### tenant_id index 必須

tenant schema の **すべての** テーブルに `tenant_id` index を作る:

```sql
CREATE INDEX idx_<table>_tenant_id ON tenant.<table>(tenant_id);
```

複合 index にする場合は `(tenant_id, ...)` の順 (leftmost prefix で活かす)。

**理由**: RLS が全クエリに `WHERE tenant_id = current_setting('app.tenant_id')`
を暗黙適用するため、index 無しは全件スキャン → 性能崩壊。

### PK/FK は ULID(text)

新規テーブルの PK/FK は `text` + ULID。Drizzle helper を使う:

```ts
import { ulidPk } from "@/db/helpers/ulid";

export const fooBar = pgTable("foo_bar", {
  id: ulidPk(),
  // ...
});
```

`serial` / `uuid` / `bigint` PK は使わない。詳細:
[`docs/design/ulid.md`](docs/design/ulid.md)。

### 認証ベンダー SDK の直接 import 禁止

Clerk SDK (`@clerk/*`, `@hono/clerk-auth`) は将来差し替え可能にしてあるので
**adapter ファイル以外から直接 import しない**:

- BE: `apps/api/src/identity/clerk-*.ts` のみ
- FE: `apps/web/src/auth/clerk-*.tsx` のみ

application コードは port (`IdentityProviderPort` / `AuthAdapter`) 越しに呼ぶ。
詳細: [`docs/design/auth-vendor-abstraction.md`](docs/design/auth-vendor-abstraction.md)。

### tenant_id propagation (middleware + AsyncLocalStorage)

API リクエスト処理では `attachTenantContext` middleware が tx を確保し、
`SELECT set_config('app.tenant_id', ...)` を発行する。`requestScope`
(AsyncLocalStorage) が tx + tenantId を保持し、`db` proxy が透過的に拾うので
**repos / usecases は tenantId を意識する必要はなく、引数にも渡さない**。

mount しない例外パス (現状):

- `/onboarding/tenant` (user は tenant 未所属)
- `/webhooks` (user session なし)
- `/public/*`, `/health`, `/invitations/:token` GET (公開エンドポイント)

詳細: [`docs/design/rls.md`](docs/design/rls.md)。

### tenant_members.role は const + type union で一本化

`role` の追加は `apps/api/src/db/schema/common.ts::TENANT_MEMBER_ROLES` を
唯一の source of truth として行う (CHECK 制約と TS union が drift しない)。

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
