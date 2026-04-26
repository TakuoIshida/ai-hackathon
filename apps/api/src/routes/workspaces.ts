import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "@/db/client";
import { type AuthVars, attachDbUser, clerkAuth, getDbUser, requireAuth } from "@/middleware/auth";
import { createResendSender, loadResendConfig } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";
import { issueInvitation, revokeInvitation } from "@/workspaces/usecase";

export type WorkspacesRouteDeps = {
  sendEmail: SendEmailFn;
  appBaseUrl: string;
};

function productionSendEmail(): SendEmailFn {
  const cfg = loadResendConfig();
  return cfg ? createResendSender(cfg) : noopSendEmail;
}

const productionDeps: WorkspacesRouteDeps = {
  sendEmail: productionSendEmail(),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:6173",
};

const inviteBodySchema = z.object({
  email: z.string().email().max(254),
});

export function createWorkspacesRoute(deps: WorkspacesRouteDeps = productionDeps) {
  const route = new Hono<{ Variables: AuthVars }>();

  route.use("*", clerkAuth());
  route.use("*", requireAuth);
  route.use("*", attachDbUser);

  // ISH-108: issue an invitation. Owner-only.
  route.post("/:id/invitations", zValidator("json", inviteBodySchema), async (c) => {
    const result = await issueInvitation(
      db,
      getDbUser(c).id,
      c.req.param("id"),
      c.req.valid("json").email,
      { sendEmail: deps.sendEmail, appBaseUrl: deps.appBaseUrl },
    );
    if (result.kind === "workspace_not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.kind === "already_invited") {
      throw new HTTPException(409, { message: "already_invited" });
    }
    return c.json(
      {
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          expiresAt: result.invitation.expiresAt,
        },
      },
      201,
    );
  });

  // Helper for owners to revoke a still-open invitation. Useful when the
  // owner wants to reset / re-issue with a different expiry.
  route.delete("/:id/invitations", zValidator("json", inviteBodySchema), async (c) => {
    const result = await revokeInvitation(
      db,
      getDbUser(c).id,
      c.req.param("id"),
      c.req.valid("json").email,
    );
    if (result.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return route;
}

export const workspacesRoute = createWorkspacesRoute();
