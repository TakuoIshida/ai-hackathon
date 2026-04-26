import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { cancelBookingByToken } from "@/bookings/cancel";
import { type CreateEventFn, confirmBooking, type GetAccessTokenFn } from "@/bookings/confirm";
import { bookingInputSchema } from "@/bookings/schemas";
import { db } from "@/db/client";
import { getValidAccessToken } from "@/google/access-token";
import { createEvent } from "@/google/calendar";
import { type GoogleConfig, loadGoogleConfig } from "@/google/config";
import { computePublicSlots } from "@/links/public-slots";
import { findPublishedLinkBySlug } from "@/links/repo";
import { createResendSender, loadResendConfig } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";

export type PublicRouteDeps = {
  loadCfg: () => GoogleConfig | null;
  createEvent: CreateEventFn;
  getAccessToken: GetAccessTokenFn;
  sendEmail: SendEmailFn;
  appBaseUrl: string;
};

function productionSendEmail(): SendEmailFn {
  const cfg = loadResendConfig();
  if (!cfg) {
    console.info("[email] RESEND_API_KEY/EMAIL_FROM not set — emails are no-op");
    return noopSendEmail;
  }
  return createResendSender(cfg);
}

const productionDeps: PublicRouteDeps = {
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

export function createPublicRoute(deps: PublicRouteDeps = productionDeps): Hono {
  const route = new Hono();

  route.get("/links/:slug", async (c) => {
    const link = await findPublishedLinkBySlug(db, c.req.param("slug"));
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

  route.get("/links/:slug/slots", zValidator("query", slotsQuery), async (c) => {
    const link = await findPublishedLinkBySlug(db, c.req.param("slug"));
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

  route.post("/links/:slug/bookings", zValidator("json", bookingInputSchema), async (c) => {
    const link = await findPublishedLinkBySlug(db, c.req.param("slug"));
    if (!link) return c.json({ error: "not_found" }, 404);

    const input = c.req.valid("json");
    const startMs = Date.parse(input.startAt);
    if (!Number.isFinite(startMs)) {
      return c.json({ error: "invalid_start_at" }, 400);
    }

    const result = await confirmBooking(
      db,
      link,
      { ...input, startMs },
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

    if (result.kind === "slot_unavailable") {
      return c.json({ error: "slot_unavailable" }, 410);
    }
    if (result.kind === "race_lost") {
      return c.json({ error: "slot_already_booked" }, 409);
    }

    const b = result.booking;
    return c.json(
      {
        booking: {
          id: b.id,
          startAt: b.startAt,
          endAt: b.endAt,
          guestName: b.guestName,
          guestEmail: b.guestEmail,
          status: b.status,
          meetUrl: b.meetUrl,
          cancellationToken: b.cancellationToken,
        },
      },
      201,
    );
  });

  // Guest-side cancel via the cancellation_token issued at booking time.
  route.post("/cancel/:token", async (c) => {
    const token = c.req.param("token");
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      return c.json({ error: "invalid_token" }, 400);
    }
    const result = await cancelBookingByToken(
      db,
      token,
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
    return c.json({ ok: true, bookingId: result.booking.id });
  });

  return route;
}

export const publicRoute = createPublicRoute();
