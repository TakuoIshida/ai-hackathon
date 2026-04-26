import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { cancelBookingByOwner } from "@/bookings/cancel";
import type { CreateEventFn, GetAccessTokenFn } from "@/bookings/confirm";
import { db } from "@/db/client";
import { bookings } from "@/db/schema/bookings";
import { availabilityLinks } from "@/db/schema/links";
import { getValidAccessToken } from "@/google/access-token";
import { createEvent } from "@/google/calendar";
import { type GoogleConfig, loadGoogleConfig } from "@/google/config";
import { type AuthVars, attachDbUser, clerkAuth, getDbUser, requireAuth } from "@/middleware/auth";
import { createResendSender, loadResendConfig } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";

export type BookingsRouteDeps = {
  loadCfg: () => GoogleConfig | null;
  createEvent: CreateEventFn;
  getAccessToken: GetAccessTokenFn;
  sendEmail: SendEmailFn;
  appBaseUrl: string;
};

function productionSendEmail(): SendEmailFn {
  const cfg = loadResendConfig();
  return cfg ? createResendSender(cfg) : noopSendEmail;
}

const productionDeps: BookingsRouteDeps = {
  loadCfg: () => {
    try {
      return loadGoogleConfig();
    } catch {
      return null;
    }
  },
  createEvent,
  getAccessToken: getValidAccessToken,
  sendEmail: productionSendEmail(),
  appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:5173",
};

export function createBookingsRoute(deps: BookingsRouteDeps = productionDeps): Hono<{
  Variables: AuthVars;
}> {
  const route = new Hono<{ Variables: AuthVars }>();
  route.use("*", clerkAuth());
  route.use("*", requireAuth);
  route.use("*", attachDbUser);

  // List all bookings owned by the authed user.
  route.get("/", async (c) => {
    const dbUser = getDbUser(c);
    // Subquery: link IDs owned by this user.
    const ownedLinks = await db
      .select({
        id: availabilityLinks.id,
        slug: availabilityLinks.slug,
        title: availabilityLinks.title,
      })
      .from(availabilityLinks)
      .where(eq(availabilityLinks.userId, dbUser.id));
    if (ownedLinks.length === 0) return c.json({ bookings: [] });
    const linkIds = ownedLinks.map((l) => l.id);
    const linkBySlug = new Map(ownedLinks.map((l) => [l.id, l]));
    const rows = await db
      .select()
      .from(bookings)
      .where(inArray(bookings.linkId, linkIds))
      .orderBy(desc(bookings.startAt));
    return c.json({
      bookings: rows.map((b) => ({
        id: b.id,
        linkId: b.linkId,
        linkTitle: linkBySlug.get(b.linkId)?.title ?? "",
        linkSlug: linkBySlug.get(b.linkId)?.slug ?? "",
        startAt: b.startAt,
        endAt: b.endAt,
        guestName: b.guestName,
        guestEmail: b.guestEmail,
        status: b.status,
        meetUrl: b.meetUrl,
        canceledAt: b.canceledAt,
        createdAt: b.createdAt,
      })),
    });
  });

  // Owner-side cancel.
  route.delete("/:id", async (c) => {
    const dbUser = getDbUser(c);
    const result = await cancelBookingByOwner(
      db,
      c.req.param("id"),
      dbUser.id,
      {
        cfg: deps.loadCfg(),
        createEvent: deps.createEvent,
        getAccessToken: deps.getAccessToken,
      },
      {
        sendEmail: deps.sendEmail,
        appBaseUrl: deps.appBaseUrl,
      },
    );
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "already_canceled") return c.json({ ok: true, alreadyCanceled: true });
    return c.json({ ok: true });
  });

  return route;
}

export const bookingsRoute = createBookingsRoute();

// silence "unused import" tripwires for `and` (kept for future filters)
void and;
