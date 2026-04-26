import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "@/db/client";
import { type AuthVars, attachDbUser, clerkAuth, getDbUser, requireAuth } from "@/middleware/auth";
import { createResendSender, loadResendConfig } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";
import { createWorkspaceInputSchema } from "@/workspaces/schemas";
import {
  changeMemberRole,
  createWorkspaceForUser,
  getWorkspaceForUser,
  issueInvitation,
  listWorkspacesForUser,
  revokeInvitation,
} from "@/workspaces/usecase";

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

const changeRoleBodySchema = z.object({
  role: z.enum(["owner", "member"]),
});

export function createWorkspacesRoute(deps: WorkspacesRouteDeps = productionDeps) {
  const route = new Hono<{ Variables: AuthVars }>();

  route.use("*", clerkAuth());
  route.use("*", requireAuth);
  route.use("*", attachDbUser);

  // ISH-107: list workspaces the caller is a member of.
  route.get("/", async (c) => {
    const list = await listWorkspacesForUser(db, getDbUser(c).id);
    return c.json({
      workspaces: list.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        role: w.role,
        createdAt: w.createdAt,
      })),
    });
  });

  // ISH-107: create a workspace + owner membership atomically.
  route.post("/", zValidator("json", createWorkspaceInputSchema), async (c) => {
    const result = await createWorkspaceForUser(db, getDbUser(c).id, c.req.valid("json"));
    if (result.kind === "slug_taken") {
      throw new HTTPException(409, { message: "slug_already_taken" });
    }
    return c.json(
      {
        workspace: {
          id: result.workspace.id,
          name: result.workspace.name,
          slug: result.workspace.slug,
          createdAt: result.workspace.createdAt,
        },
      },
      201,
    );
  });

  // ISH-107: workspace detail (members-only). Returns 404 to non-members so
  // we don't leak workspace existence.
  route.get("/:id", async (c) => {
    const result = await getWorkspaceForUser(db, getDbUser(c).id, c.req.param("id"));
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json({
      workspace: {
        id: result.workspace.id,
        name: result.workspace.name,
        slug: result.workspace.slug,
        role: result.workspace.role,
        createdAt: result.workspace.createdAt,
      },
    });
  });

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

  // ISH-111: change a member's role (owner ↔ member). Owner-only. Blocks
  // demoting the last remaining owner with 409 last_owner so the workspace
  // cannot end up ownerless.
  route.patch("/:id/members/:userId", zValidator("json", changeRoleBodySchema), async (c) => {
    const result = await changeMemberRole(
      db,
      getDbUser(c).id,
      c.req.param("id"),
      c.req.param("userId"),
      c.req.valid("json").role,
    );
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result.kind === "last_owner") {
      throw new HTTPException(409, { message: "last_owner" });
    }
    if (result.kind === "noop") return c.json({ ok: true, noop: true });
    return c.json({ ok: true });
  });

  return route;
}

export const workspacesRoute = createWorkspacesRoute();
