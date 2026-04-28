import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { attachAuth } from "@/middleware/auth";
import { bookingsRoute } from "@/routes/bookings";
import { clerkWebhookRoute } from "@/routes/clerk-webhook";
import { googleRoute } from "@/routes/google";
import { invitationsRoute } from "@/routes/invitations";
import { linksRoute } from "@/routes/links";
import { meRoute } from "@/routes/me";
import { onboardingRoute } from "@/routes/onboarding";
import { publicRoute } from "@/routes/public";
import { workspacesRoute } from "@/routes/workspaces";
import { buildIdentityProvider } from "@/wiring";

export const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
  }),
);

// Attach the identity provider middleware globally.
// This runs Clerk's JWT verification for every request and stashes identity
// claims on the context for authenticated requests. Public routes remain
// accessible — the 401 guard is applied per-route via `requireAuth`.
attachAuth(app, buildIdentityProvider());

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[api] unhandled error:", err);
  return c.json({ error: "internal_server_error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true, service: "api" }));

app.route("/me", meRoute);
app.route("/onboarding", onboardingRoute);
app.route("/google", googleRoute);
app.route("/links", linksRoute);
app.route("/bookings", bookingsRoute);
app.route("/workspaces", workspacesRoute);
app.route("/invitations", invitationsRoute);
app.route("/public", publicRoute);
app.route("/webhooks", clerkWebhookRoute);

export type AppType = typeof app;
