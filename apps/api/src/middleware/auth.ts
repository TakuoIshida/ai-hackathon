import { eq, sql } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db/client";
import { requestScope } from "@/db/request-scope";
import { tenantMembers } from "@/db/schema";
import type { TenantMemberRole } from "@/db/schema/common";
import type { IdentityClaims, IdentityProviderPort } from "@/ports/identity";
import type { User } from "@/users/domain";
import { ensureUserByClerkId } from "@/users/usecase";

// ---------------------------------------------------------------------------
// Hono typed variables
// ---------------------------------------------------------------------------

/**
 * Context variables set by the auth middleware stack.
 * Routes that mount `attachDbUser` can read `c.get("dbUser")` with the
 * correct type. Routes that run after `attachAuth` / `requireAuth` can read
 * `c.get("identityClaims")`.
 * Routes that mount `attachTenantContext` can read `c.get("tenantId")`.
 */
/**
 * tenant_members.role.
 *
 * Single source of truth lives in `db/schema/common.ts::TENANT_MEMBER_ROLES`
 * (ISH-199) — the SQL CHECK constraint and this union are derived from the
 * same const there. Re-exported here under the shorter `TenantRole` alias
 * because route / middleware code reads it via the auth module.
 */
export type TenantRole = TenantMemberRole;

export type AuthVars = {
  dbUser: User;
  identityClaims: IdentityClaims;
  tenantId: string;
  /** Caller's role within the tenant. Set by attachTenantContext alongside tenantId. */
  tenantRole: TenantRole;
  /**
   * The active identity provider for this request — stashed by `attachAuth` so
   * `attachDbUser` can call `idp.getUserByExternalId` without reaching for a
   * module-level singleton. ISH-190.
   */
  idp: IdentityProviderPort;
};

// ---------------------------------------------------------------------------
// attachAuth — composition-root helper
// ---------------------------------------------------------------------------

/**
 * Attach the vendor identity middleware to a Hono app and make identity claims
 * available on the context for every authenticated request.
 *
 * Call this once in the app bootstrap (e.g. app.ts) BEFORE route registration.
 * Public routes (health, webhooks, invitation previews) remain accessible
 * because the 401 guard is NOT applied globally here — use `requireAuth`
 * per-route to gate protected endpoints.
 *
 * ISH-190: the idp is propagated through the Hono context (`c.set("idp", ...)`)
 * instead of a module-level mutable singleton. This eliminates a hidden
 * global state and the parallel-app race that came with it.
 */
export function attachAuth(app: Hono, idp: IdentityProviderPort): void {
  // 1. Stash idp on the context so attachDbUser can find it without reaching
  //    for a module-level singleton.
  app.use("*", async (c, next) => {
    c.set("idp", idp);
    await next();
  });

  // 2. Vendor middleware: Clerk (or future provider) sets its auth state in
  //    the hono context so getClaims() can read it.
  app.use("*", idp.middleware());

  // 3. Resolve claims and stash on context. Does NOT throw for unauthenticated
  //    requests — public routes must remain accessible without a session.
  app.use("*", async (c, next) => {
    const claims = idp.getClaims(c);
    if (claims) {
      c.set("identityClaims", claims);
    }
    await next();
  });
}

// ---------------------------------------------------------------------------
// requireAuth — per-route 401 guard
// ---------------------------------------------------------------------------

/**
 * Middleware that rejects unauthenticated requests with 401.
 * Mount AFTER `attachAuth` on any route that requires a signed-in user.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const claims = c.get("identityClaims") as IdentityClaims | undefined;
  if (!claims) {
    throw new HTTPException(401, { message: "unauthorized" });
  }
  await next();
};

// ---------------------------------------------------------------------------
// getClerkUserId — backward-compat helper
// ---------------------------------------------------------------------------

/**
 * Returns the externalId (Clerk userId / sub) from the identity claims stored
 * on the context. Throws 401 HTTPException when claims are absent.
 *
 * Named `getClerkUserId` for backward compat with existing route and usecase
 * call-sites. The returned string is `IdentityClaims.externalId`.
 */
export function getClerkUserId(c: Context): string {
  const claims = c.get("identityClaims") as IdentityClaims | undefined;
  if (!claims) {
    throw new HTTPException(401, { message: "unauthorized" });
  }
  return claims.externalId;
}

// ---------------------------------------------------------------------------
// attachDbUser — DB user resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the identity-provider user → DB user once per request and stashes
 * it on the context. Mount AFTER `requireAuth` on routes that need the local
 * user record.
 *
 * Uses `c.get("idp").getUserByExternalId` (set by `attachAuth`) for the
 * lazy-create path when the user is not yet in the DB. In production this is
 * the Clerk implementation; tests can supply a fake idp via
 * `attachAuth(testApp, fakeIdp)` or bypass this middleware entirely through
 * `authMiddlewares` dependency injection in the route factory.
 *
 * ISH-190: the idp now lives on the request context, not in a module-level
 * mutable singleton — eliminates the hidden race when multiple Hono apps
 * are constructed in parallel.
 */
export const attachDbUser: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const externalId = getClerkUserId(c);
  // idp is checked lazily — `ensureUserByClerkId` only calls `getUserByExternalId`
  // when the user is missing from the DB. Tests that seed the user up front
  // never hit this branch, so they don't need to mount `attachAuth`.
  const idp = c.get("idp") as IdentityProviderPort | undefined;
  const dbUser = await ensureUserByClerkId(db, externalId, {
    getUserByExternalId: async (id) => {
      if (!idp) {
        throw new HTTPException(500, {
          message:
            "idp missing on context — call attachAuth(app, idp) before mounting attachDbUser, or inject via route factory authMiddlewares",
        });
      }
      return idp.getUserByExternalId(id);
    },
  });
  c.set("dbUser", dbUser);
  await next();
};

// ---------------------------------------------------------------------------
// getDbUser — typed context accessor
// ---------------------------------------------------------------------------

export function getDbUser(c: Context<{ Variables: AuthVars }>): User {
  const dbUser = c.get("dbUser");
  if (!dbUser) {
    throw new HTTPException(500, { message: "dbUser missing — attachDbUser not mounted" });
  }
  return dbUser;
}

// ---------------------------------------------------------------------------
// attachTenantContext — RLS tenant isolation
// ---------------------------------------------------------------------------

/**
 * Resolves the authenticated user's tenant_id from common.tenant_members,
 * opens a DB transaction, issues `SELECT set_config('app.tenant_id', ...)` so
 * that RLS policies on the tenant schema take effect, then runs the rest of
 * the middleware chain inside that transaction via AsyncLocalStorage.
 *
 * Must be mounted AFTER `attachDbUser`. The `db` proxy (client.ts) will
 * automatically use the transaction-bound client for all queries inside the
 * request scope, so repos and usecases do not need to be changed.
 *
 * Not mounted on:
 *   - /onboarding/tenant   (user has no tenant yet — they're creating one)
 *   - /webhooks            (Clerk webhook — no user session)
 *   - /public              (unauthenticated booking/cancel flows)
 *   - /health              (infra probe)
 *   - /invitations/:token  (public GET — auth is per-endpoint on POST)
 */
export const attachTenantContext: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const dbUser = getDbUser(c);

  // Open the request transaction first, then resolve tenant membership inside
  // it with `FOR SHARE` so a concurrent
  // `DELETE FROM common.tenant_members WHERE user_id = X` blocks until this
  // request commits.
  //
  // Fixed in ISH-276: lookup is now inside the same tx with FOR SHARE, closing
  // the previous TOCTOU window between membership lookup and SET LOCAL where
  // an owner-initiated revoke would not take effect for the in-flight request.
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ tenantId: tenantMembers.tenantId, role: tenantMembers.role })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, dbUser.id))
      .limit(1)
      .for("share");

    if (!member) {
      throw new HTTPException(403, { message: "user not assigned to a tenant" });
    }

    const tenantId = member.tenantId;
    // CHECK constraint on tenant_members.role enforces this set in the DB; cast
    // is safe per common.ts schema. `as TenantRole` keeps the typed accessor
    // exact rather than `string`.
    const tenantRole = member.role as TenantRole;
    c.set("tenantId", tenantId);
    c.set("tenantRole", tenantRole);

    // set_config with localval=true is equivalent to SET LOCAL — the value is
    // reset when the transaction ends, so it cannot leak across pool connections.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    await requestScope.run({ tx, tenantId }, async () => {
      await next();
    });
  });
};

// ---------------------------------------------------------------------------
// getTenantId — typed context accessor
// ---------------------------------------------------------------------------

export function getTenantId(c: Context<{ Variables: AuthVars }>): string {
  const tenantId = c.get("tenantId");
  if (!tenantId) {
    throw new HTTPException(500, { message: "tenantId missing — attachTenantContext not mounted" });
  }
  return tenantId;
}

// ---------------------------------------------------------------------------
// getTenantRole — typed context accessor (ISH-193)
// ---------------------------------------------------------------------------

/**
 * Returns the caller's role within the current tenant. Mounted by
 * `attachTenantContext` alongside `tenantId`. Routes that previously re-queried
 * `tenant_members` to check `role === "owner"` should call this instead.
 */
export function getTenantRole(c: Context<{ Variables: AuthVars }>): TenantRole {
  const role = c.get("tenantRole");
  if (!role) {
    throw new HTTPException(500, {
      message: "tenantRole missing — attachTenantContext not mounted",
    });
  }
  return role;
}
