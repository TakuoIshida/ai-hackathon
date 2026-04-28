import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "@/db/client";
import {
  linkInputSchema,
  linkUpdateSchema,
  slugSchema,
  toCreateLinkCommand,
  toUpdateLinkCommand,
} from "@/links/schemas";
import {
  checkSlugAvailability,
  createLinkForUser,
  deleteLinkForUser,
  getCoOwnersForLink,
  getLink,
  listLinks,
  setCoOwnersForLink,
  updateLinkForUser,
} from "@/links/usecase";
import { type AuthVars, attachDbUser, getDbUser, requireAuth } from "@/middleware/auth";
import { findTenantIdByUserId } from "@/users/repo";

export const linksRoute = new Hono<{ Variables: AuthVars }>();

linksRoute.use("*", requireAuth);
linksRoute.use("*", attachDbUser);

linksRoute.get(
  "/slug-available",
  zValidator("query", z.object({ slug: slugSchema })),
  async (c) => {
    const result = await checkSlugAvailability(db, c.req.valid("query").slug);
    return c.json(result);
  },
);

linksRoute.get("/", async (c) => {
  const rows = await listLinks(db, getDbUser(c).id);
  return c.json({ links: rows });
});

linksRoute.post("/", zValidator("json", linkInputSchema), async (c) => {
  const dbUser = getDbUser(c);
  const tenantId = await findTenantIdByUserId(db, dbUser.id);
  if (!tenantId) return c.json({ error: "tenant_not_found" }, 403);
  const result = await createLinkForUser(
    db,
    dbUser.id,
    tenantId,
    toCreateLinkCommand(c.req.valid("json")),
  );
  if (result.kind === "slug_taken") {
    throw new HTTPException(409, { message: "slug_already_taken" });
  }
  return c.json({ link: result.link }, 201);
});

linksRoute.get("/:id", async (c) => {
  const link = await getLink(db, getDbUser(c).id, c.req.param("id"));
  if (!link) return c.json({ error: "not_found" }, 404);
  return c.json({ link });
});

linksRoute.patch("/:id", zValidator("json", linkUpdateSchema), async (c) => {
  const result = await updateLinkForUser(
    db,
    getDbUser(c).id,
    c.req.param("id"),
    toUpdateLinkCommand(c.req.valid("json")),
  );
  if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.kind === "slug_taken") {
    throw new HTTPException(409, { message: "slug_already_taken" });
  }
  return c.json({ link: result.link });
});

linksRoute.delete("/:id", async (c) => {
  const ok = await deleteLinkForUser(db, getDbUser(c).id, c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

// ISH-112: co-owners on a link.
const coOwnersBodySchema = z.object({
  userIds: z.array(z.string().uuid()).max(20),
});

linksRoute.get("/:id/owners", async (c) => {
  const result = await getCoOwnersForLink(db, getDbUser(c).id, c.req.param("id"));
  if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
  return c.json({ coOwnerIds: result.coOwnerIds });
});

linksRoute.put("/:id/owners", zValidator("json", coOwnersBodySchema), async (c) => {
  const result = await setCoOwnersForLink(
    db,
    getDbUser(c).id,
    c.req.param("id"),
    c.req.valid("json").userIds,
  );
  if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.kind === "invalid") return c.json({ error: result.reason }, 400);
  return c.json({ coOwnerIds: result.coOwnerIds });
});
