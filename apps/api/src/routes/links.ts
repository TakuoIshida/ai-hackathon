import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db } from "@/db/client";
import {
  createLink,
  deleteLink,
  getLinkForUser,
  isSlugTaken,
  listLinksForUser,
  updateLink,
} from "@/links/repo";
import { linkInputSchema, linkUpdateSchema, slugSchema } from "@/links/schemas";
import { clerkAuth, getClerkUserId, requireAuth } from "@/middleware/auth";
import { ensureUserByClerkId } from "@/users/lookup";

export const linksRoute = new Hono();

linksRoute.use("*", clerkAuth());
linksRoute.use("*", requireAuth);

linksRoute.get(
  "/slug-available",
  zValidator("query", z.object({ slug: slugSchema })),
  async (c) => {
    const { slug } = c.req.valid("query");
    const taken = await isSlugTaken(db, slug);
    return c.json({ slug, available: !taken });
  },
);

linksRoute.get("/", async (c) => {
  const dbUser = await ensureUserByClerkId(db, getClerkUserId(c));
  const rows = await listLinksForUser(db, dbUser.id);
  return c.json({ links: rows });
});

linksRoute.post("/", zValidator("json", linkInputSchema), async (c) => {
  const dbUser = await ensureUserByClerkId(db, getClerkUserId(c));
  const input = c.req.valid("json");
  if (await isSlugTaken(db, input.slug)) {
    throw new HTTPException(409, { message: "slug_already_taken" });
  }
  const link = await createLink(db, dbUser.id, input);
  return c.json({ link }, 201);
});

linksRoute.get("/:id", async (c) => {
  const dbUser = await ensureUserByClerkId(db, getClerkUserId(c));
  const link = await getLinkForUser(db, dbUser.id, c.req.param("id"));
  if (!link) return c.json({ error: "not_found" }, 404);
  return c.json({ link });
});

linksRoute.patch("/:id", zValidator("json", linkUpdateSchema), async (c) => {
  const dbUser = await ensureUserByClerkId(db, getClerkUserId(c));
  const linkId = c.req.param("id");
  const patch = c.req.valid("json");
  if (patch.slug !== undefined) {
    const existing = await getLinkForUser(db, dbUser.id, linkId);
    if (existing && existing.slug !== patch.slug && (await isSlugTaken(db, patch.slug))) {
      throw new HTTPException(409, { message: "slug_already_taken" });
    }
  }
  const updated = await updateLink(db, dbUser.id, linkId, patch);
  if (!updated) return c.json({ error: "not_found" }, 404);
  return c.json({ link: updated });
});

linksRoute.delete("/:id", async (c) => {
  const dbUser = await ensureUserByClerkId(db, getClerkUserId(c));
  const ok = await deleteLink(db, dbUser.id, c.req.param("id"));
  if (!ok) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
