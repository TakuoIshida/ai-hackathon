# ai-hackathon

Monorepo scaffold for an AI hackathon project.

## Stack

| Layer    | Tech                                                              |
| -------- | ----------------------------------------------------------------- |
| Frontend | Vite + React 19 + TypeScript                                      |
| UI       | Radix UI Primitives + StyleX (no Tailwind, no shadcn)             |
| Backend  | Hono on **Bun** (`Bun.serve`) + TypeScript                        |
| DB       | Neon Postgres (serverless) + Drizzle ORM                          |
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

## Database (Drizzle + Neon)

```bash
bun run db:generate   # SQL migrations from schema.ts
bun run db:migrate    # apply to Neon
bun run db:studio     # open Drizzle Studio
```

Schema lives in `apps/api/src/db/schema.ts`.

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
