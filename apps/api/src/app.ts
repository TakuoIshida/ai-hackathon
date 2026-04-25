import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { clerkWebhookRoute } from "@/routes/clerk-webhook";
import { googleRoute } from "@/routes/google";
import { linksRoute } from "@/routes/links";
import { meRoute } from "@/routes/me";
import { publicRoute } from "@/routes/public";

export const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
  }),
);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[api] unhandled error:", err);
  return c.json({ error: "internal_server_error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true, service: "api" }));

app.route("/me", meRoute);
app.route("/google", googleRoute);
app.route("/links", linksRoute);
app.route("/public", publicRoute);
app.route("/webhooks", clerkWebhookRoute);

export type AppType = typeof app;
