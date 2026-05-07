import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { config } from "@/config";
import { db } from "@/db/client";
import type { TenantMemberRole } from "@/db/schema/common";
import { acceptInvitationParamsSchema, createInvitationBodySchema } from "@/invitations/schemas";
import {
  acceptInvitation,
  createInvitation,
  resendTenantInvitation,
  revokeTenantInvitation,
} from "@/invitations/usecase";
import {
  type AuthVars,
  attachDbUser,
  attachTenantContext,
  getDbUser,
  getTenantId,
  getTenantRole,
  requireAuth,
} from "@/middleware/auth";
import { createResendSender } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";
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
  /** ISH-261: injected for the resend endpoint so tests can capture mail. */
  sendEmail?: SendEmailFn;
  /** ISH-261: base URL used to build the accept link in the resend email. */
  appBaseUrl?: string;
};

const productionSendEmail: SendEmailFn = config.resend
  ? createResendSender(config.resend)
  : noopSendEmail;

// biome-ignore lint/suspicious/noExplicitAny: route factory returns a generic Hono instance
export function createTenantInvitationsRoute(deps: TenantInvitationsRouteDeps = {}): Hono<any> {
  const sendEmail = deps.sendEmail ?? productionSendEmail;
  const appBaseUrl = deps.appBaseUrl ?? config.appBaseUrl;
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

    // Caller's role is resolved by attachTenantContext alongside tenantId
    // (ISH-193) — no extra query needed here. The middleware also ensures
    // the role belongs to THIS tenantId, so the owner check is implicitly
    // tenant-scoped (resolves ISH-196 defense-in-depth concern).
    if (getTenantRole(c) !== "owner") {
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

  /**
   * DELETE /tenant/invitations/:invitationId
   *
   * Revoke a still-open invitation (ISH-256). Owner-only. Once accepted, the
   * row is preserved for audit and cannot be deleted via this endpoint —
   * 409 already_accepted in that case.
   *
   * Responses:
   *   200 { ok: true }
   *   401 unauthenticated
   *   403 caller is not an owner
   *   404 not_found (no invitation with this id in the caller's tenant)
   *   409 already_accepted
   */
  route.delete("/:invitationId", async (c) => {
    if (getTenantRole(c) !== "owner") return c.json({ error: "forbidden" }, 403);
    const tenantId = getTenantId(c);
    const callerUserId = getDbUser(c).id;
    const invitationId = c.req.param("invitationId");

    const result = await revokeTenantInvitation(db, callerUserId, tenantId, invitationId);
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "already_accepted") {
      return c.json({ error: "already_accepted" }, 409);
    }
    return c.json({ ok: true });
  });

  /**
   * ISH-261: POST /tenant/invitations/:invitationId/resend
   *
   * Re-deliver a still-open tenant invitation, extending `expiresAt` by 24h
   * so the recipient gets a fresh window. Owner-only. Mirrors the BE 規約 of
   * /tenant/invitations DELETE — accepted rows are kept for audit and cannot
   * be resent (409 already_accepted); missing / canceled rows return 404.
   *
   * Email delivery is best-effort: the row's `expiresAt` is committed first,
   * so a transient mail outage doesn't roll the extension back. The operator
   * can always click 再送 again — the only side-effect is another extension.
   *
   * Responses:
   *   200 { ok: true, expiresAt: string }
   *   401 unauthenticated
   *   403 caller is not an owner
   *   404 not_found (no invitation with this id in the caller's tenant)
   *   409 already_accepted
   */
  route.post("/:invitationId/resend", async (c) => {
    if (getTenantRole(c) !== "owner") return c.json({ error: "forbidden" }, 403);
    const tenantId = getTenantId(c);
    const invitationId = c.req.param("invitationId");

    const result = await resendTenantInvitation(db, tenantId, invitationId, {
      sendEmail,
      appBaseUrl,
    });
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "already_accepted") {
      return c.json({ error: "already_accepted" }, 409);
    }
    return c.json({ ok: true, expiresAt: result.expiresAt.toISOString() });
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
  //
  // ISH-260: include the invited role so the FE Welcome card can show
  // "オーナーとして招待されています" / "メンバーとして招待されています". role
  // is not enumeration-leaky on its own — there's no useful signal beyond
  // what the token already exposes (which tenant invited which role).
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
      role: invitation.role as TenantMemberRole,
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
