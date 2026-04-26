import { Hono } from "hono";
import { db } from "@/db/client";
import { type AuthVars, attachDbUser, clerkAuth, getDbUser, requireAuth } from "@/middleware/auth";
import { findInvitationByToken, findWorkspaceById } from "@/workspaces/repo";
import { acceptInvitation } from "@/workspaces/usecase";

/**
 * ISH-109: invitation acceptance.
 *
 * Mounted on its own (NOT under `/workspaces/:id/...`) because:
 *   - GET /invitations/:token must be public — the unauth landing page reads
 *     it before the user has signed in / chosen a workspace.
 *   - The accept flow is keyed by `token`, not by workspace id, so it would
 *     read awkwardly under the workspace router.
 *
 * Auth is applied per-route rather than as a router-level middleware so the
 * GET stays public.
 */
export function createInvitationsRoute() {
  const route = new Hono<{ Variables: AuthVars }>();

  // Public preview — no auth. The unauth landing page reads it before the
  // user has signed in to decide what UI to show. Returns only what's needed
  // to render the page; we deliberately don't echo whether the email matches
  // any signed-in caller.
  route.get("/:token", async (c) => {
    const token = c.req.param("token");
    const invitation = await findInvitationByToken(db, token);
    if (!invitation) return c.json({ error: "not_found" }, 404);
    const workspace = await findWorkspaceById(db, invitation.workspaceId);
    if (!workspace) return c.json({ error: "not_found" }, 404);
    const expired = invitation.acceptedAt !== null || invitation.expiresAt.getTime() < Date.now();
    return c.json({
      workspace: { name: workspace.name, slug: workspace.slug },
      email: invitation.email,
      expired,
    });
  });

  // Auth-gated accept. Per-route middleware so GET above stays public.
  route.post("/:token/accept", clerkAuth(), requireAuth, attachDbUser, async (c) => {
    const token = c.req.param("token");
    const dbUser = getDbUser(c);
    const result = await acceptInvitation(db, dbUser.id, dbUser.email, token);
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "expired") return c.json({ error: "expired" }, 410);
    if (result.kind === "already_accepted") return c.json({ error: "already_accepted" }, 410);
    if (result.kind === "email_mismatch") return c.json({ error: "email_mismatch" }, 409);
    return c.json({
      workspace: {
        id: result.workspace.id,
        slug: result.workspace.slug,
        name: result.workspace.name,
      },
    });
  });

  return route;
}

export const invitationsRoute = createInvitationsRoute();
