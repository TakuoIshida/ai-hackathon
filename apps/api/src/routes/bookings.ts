import { Hono, type MiddlewareHandler } from "hono";
import { cancelBookingByOwner } from "@/bookings/cancel";
import type { CreateEventFn, GetAccessTokenFn } from "@/bookings/confirm";
import { listOwnerBookings } from "@/bookings/usecase";
import { config } from "@/config";
import { db } from "@/db/client";
import { getValidAccessToken } from "@/google/access-token";
import { createEvent } from "@/google/calendar";
import type { GoogleConfig } from "@/google/config";
import { type AuthVars, attachDbUser, clerkAuth, getDbUser, requireAuth } from "@/middleware/auth";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import { createResendSender } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";

export type BookingsRouteDeps = {
  loadCfg: () => GoogleConfig | null;
  createEvent: CreateEventFn;
  getAccessToken: GetAccessTokenFn;
  sendEmail: SendEmailFn;
  appBaseUrl: string;
  // Test escape hatch: integration tests can supply fake auth middleware to
  // populate `dbUser` without going through Clerk. Production keeps the real
  // Clerk + requireAuth + attachDbUser stack.
  authMiddlewares?: MiddlewareHandler[];
};

const productionSendEmail: SendEmailFn = config.resend
  ? createResendSender(config.resend)
  : noopSendEmail;

const productionDeps: BookingsRouteDeps = {
  loadCfg: () => config.google,
  createEvent,
  getAccessToken: getValidAccessToken,
  sendEmail: productionSendEmail,
  appBaseUrl: config.appBaseUrl,
};

export function createBookingsRoute(deps: BookingsRouteDeps = productionDeps): Hono<{
  Variables: AuthVars;
}> {
  const route = new Hono<{ Variables: AuthVars }>();
  const middlewares = deps.authMiddlewares ?? [clerkAuth(), requireAuth, attachDbUser];
  for (const mw of middlewares) {
    route.use("*", mw);
  }

  // List all bookings owned by the authed user.
  route.get("/", async (c) => {
    const dbUser = getDbUser(c);
    const list = await listOwnerBookings(db, dbUser.id);
    return c.json({ bookings: list });
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
        notifier: createBookingNotifier({
          sendEmail: deps.sendEmail,
          appBaseUrl: deps.appBaseUrl,
        }),
      },
    );
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "already_canceled") return c.json({ ok: true, alreadyCanceled: true });
    return c.json({ ok: true });
  });

  return route;
}

export const bookingsRoute = createBookingsRoute();
