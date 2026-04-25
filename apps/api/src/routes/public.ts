import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "@/db/client";
import { computePublicSlots } from "@/links/public-slots";
import { findPublishedLinkBySlug } from "@/links/repo";

export const publicRoute = new Hono();

publicRoute.get("/links/:slug", async (c) => {
  const slug = c.req.param("slug");
  const link = await findPublishedLinkBySlug(db, slug);
  if (!link) return c.json({ error: "not_found" }, 404);
  return c.json({
    slug: link.slug,
    title: link.title,
    description: link.description,
    durationMinutes: link.durationMinutes,
    timeZone: link.timeZone,
  });
});

const slotsQuery = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

publicRoute.get("/links/:slug/slots", zValidator("query", slotsQuery), async (c) => {
  const slug = c.req.param("slug");
  const link = await findPublishedLinkBySlug(db, slug);
  if (!link) return c.json({ error: "not_found" }, 404);

  const { from, to } = c.req.valid("query");
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return c.json({ error: "invalid_range" }, 400);
  }

  const result = await computePublicSlots(db, link, { fromMs, toMs });
  return c.json({
    durationMinutes: link.durationMinutes,
    timeZone: link.timeZone,
    slots: result.slots.map((s) => ({
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
    })),
  });
});
