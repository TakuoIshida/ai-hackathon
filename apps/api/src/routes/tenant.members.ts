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
import { findTenantMember, removeTenantMember } from "@/tenant-members/repo";
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

  /**
   * ISH-251: remove a tenant member.
   *
   * Multi-layer guards:
   *   - 403 forbidden        : caller is not an owner
   *   - 400 cannot_remove_self : caller tried to delete themselves
   *   - 404 not_found        : target row doesn't exist in this tenant
   *   - 400 cannot_remove_owner: target is an owner (委譲フローは別 issue)
   *   - 200 ok               : row deleted
   *
   * Note: tenant_members は common schema (RLS なし) — `findTenantMember` /
   * `removeTenantMember` は (tenantId, userId) の AND 条件で必ず絞る。
   */
  route.delete("/:userId", async (c) => {
    if (getTenantRole(c) !== "owner") return c.json({ error: "forbidden" }, 403);

    const tenantId = getTenantId(c);
    const targetUserId = c.req.param("userId");
    const callerUserId = getDbUser(c).id;

    if (targetUserId === callerUserId) {
      return c.json({ error: "cannot_remove_self" }, 400);
    }

    const target = await findTenantMember(db, tenantId, targetUserId);
    if (!target) return c.json({ error: "not_found" }, 404);
    if (target.role === "owner") {
      return c.json({ error: "cannot_remove_owner" }, 400);
    }

    const ok = await removeTenantMember(db, tenantId, targetUserId);
    if (!ok) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return route;
}

export const tenantMembersRoute = createTenantMembersRoute();
