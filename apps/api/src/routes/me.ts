import { Hono, type MiddlewareHandler } from "hono";
import { db } from "@/db/client";
import { getClerkUserId, requireAuth } from "@/middleware/auth";
import { getCurrentUserByClerkId } from "@/users/usecase";

export type MeRouteDeps = {
  // Test escape hatch: integration tests can supply a fake auth middleware stack
  // to populate `identityClaims` without going through real Clerk. Production
  // relies on `attachAuth` (called in app.ts) + `requireAuth` per-route.
  authMiddlewares?: MiddlewareHandler[];
};

export function createMeRoute(deps: MeRouteDeps = {}): Hono {
  const route = new Hono();
  const middlewares = deps.authMiddlewares ?? [requireAuth];
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
      externalId: row.externalId,
      email: row.email,
      name: row.name,
      timeZone: row.timeZone,
    });
  });

  return route;
}

export const meRoute = createMeRoute();
