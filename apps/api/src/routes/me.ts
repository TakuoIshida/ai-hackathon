import { Hono } from "hono";
import { db } from "@/db/client";
import { clerkAuth, getClerkUserId, requireAuth } from "@/middleware/auth";
import { getCurrentUserByClerkId } from "@/users/usecase";

export const meRoute = new Hono();

meRoute.use("*", clerkAuth());
meRoute.use("*", requireAuth);

meRoute.get("/", async (c) => {
  const row = await getCurrentUserByClerkId(db, getClerkUserId(c));
  if (!row) {
    return c.json({ error: "user not synced yet" }, 404);
  }
  return c.json({
    id: row.id,
    clerkId: row.clerkId,
    email: row.email,
    name: row.name,
    timeZone: row.timeZone,
  });
});
