import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { type CancelBookingPorts, cancelBookingByToken } from "@/bookings/cancel";
import { type ConfirmBookingPorts, confirmBooking } from "@/bookings/confirm";
import { bookingInputSchema, toConfirmBookingCommand } from "@/bookings/schemas";
import { config } from "@/config";
import { db } from "@/db/client";
import { findLinkBySlug } from "@/links/repo";
import { computePublicSlots } from "@/links/usecase";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import { createResendSender } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";
import type {
  GooglePort,
  LinkAvailabilityPort,
  LinkLookupPort,
  NotificationPort,
  UserLookupPort,
} from "@/ports";
import {
  buildGooglePort,
  buildLinkAvailabilityPort,
  buildLinkLookupPort,
  buildUserLookupPort,
} from "@/wiring";

export type PublicRouteDeps = {
  google: GooglePort | null;
  links: LinkLookupPort;
  availability: LinkAvailabilityPort;
  users: UserLookupPort;
  notifier: NotificationPort;
};

function buildProductionSendEmail(): SendEmailFn {
  if (!config.resend) {
    console.info("[email] RESEND_API_KEY/EMAIL_FROM not set — emails are no-op");
    return noopSendEmail;
  }
  return createResendSender(config.resend);
}

function buildProductionDeps(): PublicRouteDeps {
  const google = buildGooglePort(db, config.google);
  return {
    google,
    links: buildLinkLookupPort(db),
    // confirmBooking's slot revalidation only re-checks the rules grid; busy
    // intervals are skipped (the bookings.uniq_bookings_active_slot index is
    // what guards races, not this re-check). Pass `null` so the port mirrors
    // the historical behavior. The slots endpoint below calls
    // `computePublicSlots` directly with `deps.google` for busy merge.
    availability: buildLinkAvailabilityPort(db, null),
    users: buildUserLookupPort(db),
    notifier: createBookingNotifier({
      sendEmail: buildProductionSendEmail(),
      appBaseUrl: config.appBaseUrl,
    }),
  };
}

const productionDeps: PublicRouteDeps = buildProductionDeps();

export function createPublicRoute(deps: PublicRouteDeps = productionDeps): Hono {
  const route = new Hono();

  route.get("/links/:slug", async (c) => {
    const link = await findLinkBySlug(db, c.req.param("slug"));
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
    const link = await findLinkBySlug(db, c.req.param("slug"));
    if (!link) return c.json({ error: "not_found" }, 404);

    const { from, to } = c.req.valid("query");
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      return c.json({ error: "invalid_range" }, 400);
    }

    const result = await computePublicSlots(db, link, { fromMs, toMs }, deps.google);
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
    const link = await findLinkBySlug(db, c.req.param("slug"));
    if (!link) return c.json({ error: "not_found" }, 404);

    const command = toConfirmBookingCommand(c.req.valid("json"));
    if (!command) {
      return c.json({ error: "invalid_start_at" }, 400);
    }

    const ports: ConfirmBookingPorts = {
      google: deps.google,
      links: deps.links,
      availability: deps.availability,
      users: deps.users,
      notifier: deps.notifier,
    };
    const result = await confirmBooking(db, link, command, ports);

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
    const ports: CancelBookingPorts = {
      google: deps.google,
      links: deps.links,
      users: deps.users,
      notifier: deps.notifier,
    };
    const result = await cancelBookingByToken(db, token, ports);
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "already_canceled") return c.json({ ok: true, alreadyCanceled: true });
    return c.json({ ok: true, bookingId: result.booking.id });
  });

  return route;
}

export const publicRoute = createPublicRoute();
