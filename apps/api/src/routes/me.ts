import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { clerkAuth, getClerkUserId, requireAuth } from "@/middleware/auth";

export const meRoute = new Hono();

meRoute.use("*", clerkAuth());
meRoute.use("*", requireAuth);

meRoute.get("/", async (c) => {
  const clerkId = getClerkUserId(c);
  const [row] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
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
