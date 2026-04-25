# syntax=docker/dockerfile:1.7
# Build context: repo root (so workspace deps resolve)
# Build:  docker build -f apps/api/Dockerfile -t ai-hackathon-api .
# Run:    docker run -p 8787:8787 --env-file apps/api/.env ai-hackathon-api

# === deps stage: install workspace deps ===
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile --production

# === runtime stage ===
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# install tini for proper signal forwarding to bun
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 8787
USER bun

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
