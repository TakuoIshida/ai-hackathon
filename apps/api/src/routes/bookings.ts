import { Hono, type MiddlewareHandler } from "hono";
import { type CancelBookingPorts, cancelBookingByOwner } from "@/bookings/cancel";
import { listOwnerBookings } from "@/bookings/usecase";
import { config } from "@/config";
import { db } from "@/db/client";
import {
  type AuthVars,
  attachDbUser,
  attachTenantContext,
  getDbUser,
  requireAuth,
} from "@/middleware/auth";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import { createResendSender } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";
import type { GooglePort, LinkLookupPort, NotificationPort, UserLookupPort } from "@/ports";
import { buildGooglePort, buildLinkLookupPort, buildUserLookupPort } from "@/wiring";

export type BookingsRouteDeps = {
  google: GooglePort | null;
  links: LinkLookupPort;
  users: UserLookupPort;
  notifier: NotificationPort;
  // Test escape hatch: integration tests can supply fake auth middleware to
  // populate `dbUser` without going through Clerk. Production keeps the real
  // Clerk + requireAuth + attachDbUser stack.
  authMiddlewares?: MiddlewareHandler[];
};

const productionSendEmail: SendEmailFn = config.resend
  ? createResendSender(config.resend)
  : noopSendEmail;

const productionDeps: BookingsRouteDeps = {
  google: buildGooglePort(db, config.google),
  links: buildLinkLookupPort(db),
  users: buildUserLookupPort(db),
  notifier: createBookingNotifier({
    sendEmail: productionSendEmail,
    appBaseUrl: config.appBaseUrl,
  }),
};

export function createBookingsRoute(deps: BookingsRouteDeps = productionDeps): Hono<{
  Variables: AuthVars;
}> {
  const route = new Hono<{ Variables: AuthVars }>();
  const middlewares = deps.authMiddlewares ?? [requireAuth, attachDbUser, attachTenantContext];
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
    const ports: CancelBookingPorts = {
      google: deps.google,
      links: deps.links,
      users: deps.users,
      notifier: deps.notifier,
    };
    const result = await cancelBookingByOwner(db, c.req.param("id"), dbUser.id, ports);
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "already_canceled") return c.json({ ok: true, alreadyCanceled: true });
    return c.json({ ok: true });
  });

  return route;
}

export const bookingsRoute = createBookingsRoute();
