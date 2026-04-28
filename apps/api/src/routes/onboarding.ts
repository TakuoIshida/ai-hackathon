import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { db } from "@/db/client";
import { type AuthVars, attachDbUser, getDbUser, requireAuth } from "@/middleware/auth";
import { createTenantBodySchema } from "@/tenants/schemas";
import { createTenantForUser } from "@/tenants/usecase";

export type OnboardingRouteDeps = {
  /** Test escape hatch: inject fake auth middleware instead of real requireAuth + attachDbUser. */
  authMiddlewares?: MiddlewareHandler[];
};

// biome-ignore lint/suspicious/noExplicitAny: route factory returns a generic Hono instance
export function createOnboardingRoute(deps: OnboardingRouteDeps = {}): Hono<any> {
  const route = new Hono<{ Variables: AuthVars }>();

  if (deps.authMiddlewares) {
    for (const mw of deps.authMiddlewares) {
      route.use("*", mw);
    }
  } else {
    route.use("*", requireAuth);
    route.use("*", attachDbUser);
  }

  /**
   * POST /onboarding/tenant
   *
   * Create a new tenant for the authenticated user and add them as owner.
   * Idempotency: if the user is already a member of a tenant, returns 409.
   *
   * Body: { name: string } (1–120 chars, trimmed)
   * Responses:
   *   201 { tenantId, name, role }
   *   400 zod validation error
   *   401 unauthenticated
   *   409 { error: "already_member" }
   */
  route.post("/tenant", zValidator("json", createTenantBodySchema), async (c) => {
    const dbUser = getDbUser(c);
    const { name } = c.req.valid("json");

    const result = await createTenantForUser(db, dbUser.id, { name });

    if (result.kind === "already_member") {
      return c.json({ error: "already_member" }, 409);
    }

    return c.json(
      {
        tenantId: result.tenantId,
        name: result.tenantName,
        role: result.role,
      },
      201,
    );
  });

  return route;
}

export const onboardingRoute = createOnboardingRoute();
