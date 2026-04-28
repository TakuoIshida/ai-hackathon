import { eq, sql } from "drizzle-orm";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db/client";
import { requestScope } from "@/db/request-scope";
import { tenantMembers } from "@/db/schema";
import { buildClerkIdentityProvider } from "@/identity/clerk-identity-provider";
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
export type AuthVars = {
  dbUser: User;
  identityClaims: IdentityClaims;
  tenantId: string;
};

// ---------------------------------------------------------------------------
// Module-level Clerk identity provider singleton
// ---------------------------------------------------------------------------

/**
 * Singleton used by `attachDbUser` for the lazy-create path.
 * Initialized once at module load so the Clerk client is constructed once,
 * not on every request. `attachAuth` replaces this when called (to support
 * dependency injection in tests that supply a fake idp).
 */
let _idp: IdentityProviderPort = buildClerkIdentityProvider();

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
 */
export function attachAuth(app: Hono, idp: IdentityProviderPort): void {
  // Store idp so attachDbUser's lazy-create path uses the same provider.
  _idp = idp;

  // 1. Vendor middleware: Clerk (or future provider) sets its auth state in
  //    the hono context so getClaims() can read it.
  app.use("*", idp.middleware());

  // 2. Resolve claims and stash on context. Does NOT throw for unauthenticated
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
 * Uses `_idp.getUserByExternalId` (the module-level identity provider set by
 * `attachAuth`) for the lazy-create path when the user is not yet in the DB.
 * In production this is the Clerk implementation; tests can supply a fake idp
 * via `attachAuth(app, fakeIdp)` or bypass this middleware entirely through
 * `authMiddlewares` dependency injection in the route factory.
 */
export const attachDbUser: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const externalId = getClerkUserId(c);
  const idp = _idp;
  const dbUser = await ensureUserByClerkId(db, externalId, {
    getUserByExternalId: (id) => idp.getUserByExternalId(id),
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

  // Resolve tenant membership using the baseline db (outside of scope — this
  // query hits common.tenant_members which has no RLS).
  const [member] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, dbUser.id))
    .limit(1);

  if (!member) {
    throw new HTTPException(403, { message: "user not assigned to a tenant" });
  }

  const tenantId = member.tenantId;
  c.set("tenantId", tenantId);

  // Open a transaction for the entire request so SET LOCAL is scoped to it.
  // The requestScope AsyncLocalStorage makes `tx` available to the `db` proxy
  // so all downstream queries automatically use the transaction connection.
  await db.transaction(async (tx) => {
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
