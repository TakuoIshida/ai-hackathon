import { Hono, type MiddlewareHandler } from "hono";
import { db } from "@/db/client";
import {
  type AuthVars,
  attachDbUser,
  attachTenantContext,
  getDbUser,
  getTenantId,
  getTenantRole,
  requireAuth,
} from "@/middleware/auth";
import { listTenantMembers } from "@/tenant-members/usecase";

/**
 * ISH-250: tenant-scoped members listing.
 *
 * `GET /tenant/members` returns active members + open (pending/expired)
 * invitations as a single list, plus the caller's role and userId.
 *
 * RLS scoping:
 *   - common.tenant_members has no RLS — repo uses an explicit tenantId filter.
 *   - tenant.invitations has RLS — `attachTenantContext` sets app.tenant_id
 *     so cross-tenant rows are invisible. Repo redundantly applies tenantId
 *     for defense-in-depth.
 */

export type TenantMembersRouteDeps = {
  /** Test escape hatch: inject fake auth middleware stack. */
  authMiddlewares?: MiddlewareHandler[];
};

// biome-ignore lint/suspicious/noExplicitAny: route factory returns a generic Hono instance
export function createTenantMembersRoute(deps: TenantMembersRouteDeps = {}): Hono<any> {
  const route = new Hono<{ Variables: AuthVars }>();

  if (deps.authMiddlewares) {
    for (const mw of deps.authMiddlewares) {
      route.use("*", mw);
    }
  } else {
    route.use("*", requireAuth);
    route.use("*", attachDbUser);
    route.use("*", attachTenantContext);
  }

  route.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const dbUser = getDbUser(c);
    const callerRole = getTenantRole(c);
    const members = await listTenantMembers(db, tenantId);
    return c.json({ members, callerRole, callerUserId: dbUser.id });
  });

  return route;
}

export const tenantMembersRoute = createTenantMembersRoute();
