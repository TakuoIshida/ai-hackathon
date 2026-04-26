import { Hono } from "hono";
import { Webhook } from "svix";
import { db } from "@/db/client";
import type { ClerkUserPayload } from "@/users/domain";
import { applyClerkUserDelete, applyClerkUserUpsert } from "@/users/usecase";

type ClerkEvent =
  | { type: "user.created" | "user.updated"; data: ClerkUserPayload }
  | { type: "user.deleted"; data: { id: string; deleted?: boolean } }
  | { type: string; data: unknown };

export const clerkWebhookRoute = new Hono();

clerkWebhookRoute.post("/clerk", async (c) => {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] CLERK_WEBHOOK_SECRET is not set");
    return c.json({ error: "webhook not configured" }, 500);
  }

  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: "missing svix headers" }, 400);
  }

  const body = await c.req.text();

  let event: ClerkEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    console.warn("[webhook] signature verification failed:", err);
    return c.json({ error: "invalid signature" }, 400);
  }

  switch (event.type) {
    case "user.created":
    case "user.updated":
      await applyClerkUserUpsert(db, event.data as ClerkUserPayload);
      break;
    case "user.deleted": {
      const data = event.data as { id: string };
      if (data.id) await applyClerkUserDelete(db, data.id);
      break;
    }
    default:
      // ignore other event types
      break;
  }

  return c.json({ ok: true });
});
