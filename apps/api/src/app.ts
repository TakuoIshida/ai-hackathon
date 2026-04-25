import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
  }),
);

// Public routes
app.get("/health", (c) => c.json({ ok: true, service: "api" }));

// Protected routes — Clerk middleware reads CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY
// from env at request time, so we only mount it where auth is required.
app.use("/me", clerkMiddleware());
app.get("/me", (c) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json({ userId: auth.userId });
});

export type AppType = typeof app;
