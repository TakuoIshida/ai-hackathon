import { Hono, type MiddlewareHandler } from "hono";
import { db } from "@/db/client";
import { clerkAuth, getClerkUserId, requireAuth } from "@/middleware/auth";
import { getCurrentUserByClerkId } from "@/users/usecase";

export type MeRouteDeps = {
  // Test escape hatch: integration tests can supply a fake auth middleware stack
  // to populate `clerkAuth` without going through real Clerk. Production keeps
  // the real `clerkAuth() + requireAuth` stack.
  authMiddlewares?: MiddlewareHandler[];
};

export function createMeRoute(deps: MeRouteDeps = {}): Hono {
  const route = new Hono();
  const middlewares = deps.authMiddlewares ?? [clerkAuth(), requireAuth];
  for (const mw of middlewares) {
    route.use("*", mw);
  }

  route.get("/", async (c) => {
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

  return route;
}

export const meRoute = createMeRoute();
