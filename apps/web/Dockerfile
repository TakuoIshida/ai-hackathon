# syntax=docker/dockerfile:1.7
# Build context: repo root
# Build:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.com \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_xxx \
#     -t ai-hackathon-web .
# Run:    docker run -p 8080:80 ai-hackathon-web

# === deps stage ===
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN bun install --frozen-lockfile

# === build stage: vite static build ===
FROM deps AS builder
WORKDIR /app
COPY apps/web ./apps/web

# Vite inlines VITE_* env at build time
ARG VITE_API_URL=http://localhost:8787
ARG VITE_CLERK_PUBLISHABLE_KEY=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

WORKDIR /app/apps/web
RUN bun run build

# === runtime stage: nginx ===
FROM nginx:1.27-alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
