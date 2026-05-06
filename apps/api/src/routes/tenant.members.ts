import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { db } from "@/db/client";
import { TENANT_MEMBER_ROLES } from "@/db/schema/common";
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
import { changeTenantMemberRole, listTenantMembers } from "@/tenant-members/usecase";

/**
 * ISH-250 / ISH-251 / ISH-256: tenant-scoped member operations.
 *
 *   GET    /tenant/members          — list active members + open invitations
 *   PATCH  /tenant/members/:userId  — change role (owner ↔ member, owner only)
 *   DELETE /tenant/members/:userId  — remove a member from the tenant (owner only)
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

const changeRoleBodySchema = z.object({
  role: z.enum(TENANT_MEMBER_ROLES),
});

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
   * ISH-256: change a member's role (owner ↔ member). Owner-only. Blocks
   * demoting the last remaining owner with 409 last_owner so the tenant
   * cannot end up ownerless. Returns `{ ok: true, noop: true }` when the
   * new role equals the current role (idempotent — the FE may fire this
   * without checking the current value).
   */
  route.patch("/:userId", zValidator("json", changeRoleBodySchema), async (c) => {
    if (getTenantRole(c) !== "owner") return c.json({ error: "forbidden" }, 403);
    const tenantId = getTenantId(c);
    const callerUserId = getDbUser(c).id;
    const targetUserId = c.req.param("userId");
    const { role } = c.req.valid("json");

    const result = await changeTenantMemberRole(db, callerUserId, tenantId, targetUserId, role);
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "last_owner") return c.json({ error: "last_owner" }, 409);
    if (result.kind === "noop") return c.json({ ok: true, noop: true });
    return c.json({ ok: true });
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
