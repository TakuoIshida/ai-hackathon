# ai-hackathon

Monorepo scaffold for an AI hackathon project.

## Stack

| Layer    | Tech                                                              |
| -------- | ----------------------------------------------------------------- |
| Frontend | Vite + React 19 + TypeScript                                      |
| UI       | Radix UI Primitives + StyleX (no Tailwind, no shadcn)             |
| Backend  | Hono on **Bun** (`Bun.serve`) + TypeScript                        |
| DB       | Postgres (Cloud SQL in prod, docker-compose Postgres 17 in dev) + Drizzle ORM |
| Auth     | Clerk (`@clerk/clerk-react` on web, `@hono/clerk-auth` on api)    |
| PM       | **Bun** workspaces (`bun.lock`)                                   |
| Quality  | **Biome** (format + lint, single config) + `tsc --noEmit`         |
| Hooks    | **lefthook** (pre-commit: biome check, pre-push: typecheck + biome)|
| Container| Multi-stage Docker (oven/bun + nginx) for portable deploy         |

## Layout

```
apps/
  web/   # Vite + React + StyleX + Radix      (Dockerfile → nginx static)
  api/   # Hono + Bun + Drizzle + Clerk        (Dockerfile → oven/bun:slim)
render.yaml          # Render Blueprint (Docker services)
docker-compose.yml   # local docker test
.env.example
```

## Setup

```bash
bun install                          # installs all workspaces
cp .env.example apps/api/.env        # fill DATABASE_URL + CLERK_*
cp .env.example apps/web/.env        # fill VITE_*
```

## ローカル開発 DB (Postgres 17)

ローカル開発では `docker-compose.dev.yml` で本物の Postgres 17 を立ち上げて
`DATABASE_URL` を向けます (PGlite はテスト用)。

### DB ロール設計 (RLS 対応)

| 環境変数 | ロール | 用途 |
|----------|--------|------|
| `DATABASE_URL` | `app` | API サーバー runtime — RLS が適用される |
| `DATABASE_URL_ADMIN` | `admin` | `drizzle-kit` migration 専用 — `BYPASSRLS` 付き |

- `app` / `admin` ロールは `0003_rls.sql` migration が初回実行時に自動作成します
- `DATABASE_URL_ADMIN` は API コンテナに渡さず、CI/CD の Secret Manager のみで管理します
- ローカルでは `.env.example` のデフォルト値をそのまま使えます

```bash
# 起動 (バックグラウンド)
docker compose -f docker-compose.dev.yml up -d

# apps/api/.env に以下を設定 (.env.example のデフォルト):
# DATABASE_URL=postgres://app:app@localhost:5432/app_dev       (runtime — RLS 適用)
# DATABASE_URL_ADMIN=postgres://admin:admin@localhost:5432/app_dev  (migration 専用)

# スキーマ適用 (drizzle-kit — DATABASE_URL_ADMIN を使用)
bun run --filter @app/api db:push

# 接続確認
pg_isready -h localhost -p 5432 -U postgres

# 停止 + データ削除 (ボリューム破棄)
docker compose -f docker-compose.dev.yml down -v
```

データは名前付きボリューム `postgres-data` に永続化されます。完全リセットは
`down -v`。

## Run (local, no Docker)

```bash
bun run dev          # starts web (6173) + api (8787) in parallel
bun run typecheck    # tsc across both apps
```

Per-app:

```bash
bun --filter @app/web dev
bun --filter @app/api dev    # bun --hot src/index.ts
```

## Quality (format / lint / typecheck)

```bash
bun run check        # biome (format + lint) — read-only
bun run check:fix    # biome — write fixes & organize imports
bun run format       # biome format only (write)
bun run lint         # biome lint only (read-only)
bun run lint:fix     # biome lint --write
bun run typecheck    # tsc --noEmit across workspaces
```

Git hooks (auto-installed by `bun install` via the `prepare` script):
- **pre-commit**: `biome check --write` on staged files (auto-formats and re-stages)
- **pre-push**: full `bun run typecheck` + `bun run check`

Manual hook re-install: `bunx lefthook install`. Bypass for emergencies: `git commit --no-verify`.

## E2E tests (Playwright)

```bash
# one-time browser install (~92MB chromium)
bunx --cwd apps/e2e playwright install chromium

bun run e2e          # headless run, auto-starts api + web dev servers
bun run e2e:ui       # interactive UI mode (recommended for writing tests)
bun run e2e:headed   # watch the browser
bun run e2e:report   # open the last HTML report
```

Specs live in `apps/e2e/tests/`. Playwright's `webServer` config in
`apps/e2e/playwright.config.ts` auto-starts both `bun run --filter @app/api dev`
and `bun run --filter @app/web dev` (and reuses them locally if already running).
On CI the dev servers are launched fresh.

## Run (Docker, mirrors prod)

```bash
# write .env at repo root with DATABASE_URL, CLERK_*, VITE_*
docker compose up --build
# api  → http://localhost:8787
# web  → http://localhost:6173
```

## Database (Drizzle + Postgres)

```bash
bun run db:generate   # SQL migrations from schema.ts
bun run db:migrate    # apply to the DATABASE_URL_ADMIN target
bun run db:studio     # open Drizzle Studio
```

Schema lives in `apps/api/src/db/schema/` (one file per logical group:
`common.ts`, `tenant.ts`, `links.ts`, `bookings.ts`, `google.ts`).

## Schema map (multi-tenant)

Schema 構成は **multi-tenant** で `common` (tenant 横断) と `tenant`
(tenant スコープ + RLS) に分かれている。

| Schema | テーブル |
|--------|---------|
| `common` | `users`, `tenants`, `tenant_members` |
| `tenant` | `availability_links`, `availability_rules`, `availability_excludes`, `bookings`, `link_owners`, `google_oauth_accounts`, `google_calendars`, `invitations` |

共通ルール:

- 全 PK/FK は **ULID(text)** (`apps/api/src/db/helpers/ulid.ts::ulidPk`)
- `tenant.*` は `tenant_id text NOT NULL REFERENCES common.tenants(id)` +
  **`tenant_id` index 必須**
- `tenant.*` は全テーブル `ENABLE ROW LEVEL SECURITY`、`app.tenant_id`
  セッション変数で絞る (request scope で `SELECT set_config(...)`)
- DB role: migration は `admin` (BYPASSRLS)、runtime は `app` (RLS 適用)

設計ドキュメント:

- [`docs/design/schema-map.md`](docs/design/schema-map.md) — 全テーブル仕様
- [`docs/design/rls.md`](docs/design/rls.md) — RLS / role / SET LOCAL
- [`docs/design/ulid.md`](docs/design/ulid.md) — ULID 戦略
- [`docs/design/auth-vendor-abstraction.md`](docs/design/auth-vendor-abstraction.md) —
  `IdentityProviderPort` / `AuthAdapter`

AI agent 向け規約は [`CLAUDE.md`](CLAUDE.md) の "Multi-tenant 規約" を参照。

## API endpoints

- `GET /health` — public, no auth (used as Render healthcheck)
- `GET /me` — requires Clerk session

## Deploy

### Render (one-click via Blueprint)
1. Push to GitHub, connect repo in Render → "New Blueprint Instance"
2. `render.yaml` provisions both services as Docker
3. Fill the secret env vars in the Render UI (`DATABASE_URL`, `CLERK_*`, `VITE_CLERK_PUBLISHABLE_KEY`)

### GCP Cloud Run (later)
```bash
# api
gcloud builds submit --tag gcr.io/PROJECT/ai-hackathon-api -f apps/api/Dockerfile .
gcloud run deploy ai-hackathon-api --image gcr.io/PROJECT/ai-hackathon-api \
  --set-env-vars NODE_ENV=production,DATABASE_URL=...,CLERK_SECRET_KEY=...
```

### AWS App Runner / ECS Fargate (later)
Push image to ECR, point service at it. Same Dockerfile, same env vars.

## UI conventions

- Use **Radix UI Primitives** (`@radix-ui/react-*`) for unstyled, accessible behavior.
- Style with **StyleX** (`@stylexjs/stylex`). Tokens in `apps/web/src/styles/tokens.stylex.ts`.
- Reference: `apps/web/src/components/ui/button.tsx` (variant/size + Radix `Slot` for `asChild`).

## Notes

- Bun api: `bun --hot` for dev, `Bun.serve` for runtime, SIGTERM drains in-flight requests via `server.stop()`.
- Web container is nginx-alpine (~50MB). API container is oven/bun:1-slim + tini (~270MB).
- `vite-plugin-stylex@0.13` peer-warns against stylex 0.10.x; build works. Revisit if HMR misbehaves.
- Vite pinned at 5 because vite-plugin-stylex doesn't yet support Vite 6.
