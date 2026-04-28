import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { db } from "@/db/client";
import { tenantMembers } from "@/db/schema/common";
import { acceptInvitationParamsSchema, createInvitationBodySchema } from "@/invitations/schemas";
import { acceptInvitation, createInvitation } from "@/invitations/usecase";
import {
  type AuthVars,
  attachDbUser,
  attachTenantContext,
  getDbUser,
  getTenantId,
  requireAuth,
} from "@/middleware/auth";
import { findInvitationByToken, findWorkspaceById } from "@/workspaces/repo";

/**
 * ISH-176: tenant-scoped invitation flow.
 *
 * Two separate routers:
 *   - `tenantInvitationsRoute` → mounted at `/tenant/invitations` (owner-only,
 *     behind attachTenantContext)
 *   - `invitationsRoute` → mounted at `/invitations` (accept endpoint — no
 *     attachTenantContext because invitee has no tenant membership yet)
 *
 * The existing GET /invitations/:token (public preview) is preserved for
 * backwards-compatibility with the FE AcceptInvite page.
 */

// ---------------------------------------------------------------------------
// POST /tenant/invitations — issue a new invitation (owner only)
// ---------------------------------------------------------------------------

export type TenantInvitationsRouteDeps = {
  /** Test escape hatch: inject fake auth middleware stack. */
  authMiddlewares?: MiddlewareHandler[];
};

// biome-ignore lint/suspicious/noExplicitAny: route factory returns a generic Hono instance
export function createTenantInvitationsRoute(deps: TenantInvitationsRouteDeps = {}): Hono<any> {
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

  /**
   * POST /tenant/invitations
   *
   * Issue a new invitation to join the caller's tenant. Only owners may issue
   * invitations.
   *
   * Body: { email: string, role?: "owner" | "member" }
   * Responses:
   *   201 { invitationId, token, expiresAt }
   *   400 zod validation error
   *   401 unauthenticated
   *   403 caller is not an owner
   *   409 { error: "already_member" | "already_invited" }
   */
  route.post("/", zValidator("json", createInvitationBodySchema), async (c) => {
    const dbUser = getDbUser(c);
    const tenantId = getTenantId(c);
    const { email, role } = c.req.valid("json");

    // Verify the caller is an owner of this tenant.
    const [membership] = await db
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, dbUser.id))
      .limit(1);

    if (!membership || membership.role !== "owner") {
      return c.json({ error: "forbidden" }, 403);
    }

    const result = await createInvitation(db, tenantId, dbUser.id, { email, role });

    if (result.kind === "already_member") {
      return c.json({ error: "already_member" }, 409);
    }
    if (result.kind === "already_invited") {
      return c.json({ error: "already_invited" }, 409);
    }

    return c.json(
      {
        invitationId: result.invitationId,
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
      },
      201,
    );
  });

  return route;
}

export const tenantInvitationsRoute = createTenantInvitationsRoute();

// ---------------------------------------------------------------------------
// /invitations — accept flow + public preview
// ---------------------------------------------------------------------------

export type InvitationsRouteDeps = {
  /** Test escape hatch: inject fake auth middleware instead of real requireAuth + attachDbUser. */
  authMiddlewares?: MiddlewareHandler[];
};

// biome-ignore lint/suspicious/noExplicitAny: route factory returns a generic Hono instance
export function createInvitationsRoute(deps: InvitationsRouteDeps = {}): Hono<any> {
  const route = new Hono<{ Variables: AuthVars }>();

  // Public preview — no auth. The unauth landing page reads it before the
  // user has signed in to decide what UI to show. Returns only what's needed
  // to render the page; intentionally MINIMAL.
  //
  // ISH-208: do NOT include the invited email in the response. An attacker
  // who guesses or steals a token URL would otherwise be able to enumerate
  // which email a tenant invited. The FE renders only the workspace name +
  // expired flag — the email match is implicitly checked at POST /accept
  // time (collapsed to 404 by ISH-194).
  route.get("/:token", async (c) => {
    const token = c.req.param("token");
    const invitation = await findInvitationByToken(db, token);
    if (!invitation) return c.json({ error: "not_found" }, 404);
    const workspace = await findWorkspaceById(db, invitation.tenantId);
    if (!workspace) return c.json({ error: "not_found" }, 404);
    const expired = invitation.acceptedAt !== null || invitation.expiresAt.getTime() < Date.now();
    return c.json({
      workspace: { name: workspace.name },
      expired,
    });
  });

  /**
   * POST /invitations/:token/accept
   *
   * Accept a tenant invitation. The caller must be authenticated but does NOT
   * need an existing tenant membership (they're joining via this invite).
   * attachTenantContext is intentionally NOT mounted here — same pattern as
   * /onboarding/tenant.
   *
   * Params: token (UUID v4)
   * Responses:
   *   201 { tenantId, role }
   *   401 unauthenticated
   *   404 not_found (invalid token OR caller email ≠ invitee email — the
   *                 mismatch case collapses to not_found per ISH-194 to avoid
   *                 leaking that the token is otherwise live to a non-invitee)
   *   409 already_accepted | user_already_in_tenant
   *   410 expired
   */
  if (deps.authMiddlewares) {
    for (const mw of deps.authMiddlewares) {
      route.use("/:token/accept", mw);
    }
  } else {
    route.use("/:token/accept", requireAuth);
    route.use("/:token/accept", attachDbUser);
  }

  route.post("/:token/accept", zValidator("param", acceptInvitationParamsSchema), async (c) => {
    const { token } = c.req.valid("param");
    const dbUser = getDbUser(c);

    const result = await acceptInvitation(db, dbUser.id, dbUser.email, token);

    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "expired") return c.json({ error: "expired" }, 410);
    if (result.kind === "already_accepted") return c.json({ error: "already_accepted" }, 409);
    if (result.kind === "user_already_in_tenant") {
      return c.json({ error: "user_already_in_tenant" }, 409);
    }

    return c.json({ tenantId: result.tenantId, role: result.role }, 201);
  });

  return route;
}

export const invitationsRoute = createInvitationsRoute();
