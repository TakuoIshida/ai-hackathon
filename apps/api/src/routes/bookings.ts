import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { type CancelBookingPorts, cancelBookingByOwner } from "@/bookings/cancel";
import { getOwnerBooking, listOwnerBookingsPaged } from "@/bookings/usecase";
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

  // List all bookings owned by the authed user. ISH-268: search/status/pagination
  // moved server-side. The previous "return everything, filter on the FE" path
  // does not scale past a few hundred bookings.
  //
  // - `q`: case-insensitive partial match on guestName / guestEmail / linkTitle
  // - `status`: "all" (default) | "confirmed" | "canceled"; "all" is encoded
  //   on the wire so the FE state can round-trip cleanly, but the SQL layer
  //   only narrows when status !== "all".
  // - `page`: 1-based (default 1)
  // - `pageSize`: default 25, clamped to [1, 100] to bound payload size.
  route.get(
    "/",
    zValidator(
      "query",
      z.object({
        q: z.string().trim().max(200).optional(),
        status: z.enum(["all", "confirmed", "canceled"]).optional().default("all"),
        page: z.coerce.number().int().min(1).optional().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
      }),
    ),
    async (c) => {
      const dbUser = getDbUser(c);
      const { q, status, page, pageSize } = c.req.valid("query");
      const result = await listOwnerBookingsPaged(db, dbUser.id, {
        q: q && q.length > 0 ? q : undefined,
        status: status === "all" ? undefined : status,
        page,
        pageSize,
      });
      return c.json(result);
    },
  );

  // ISH-254: dedicated detail endpoint. Returns 404 for both missing and
  // foreign booking ids — see `getOwnerBooking` for rationale.
  route.get("/:id", async (c) => {
    const dbUser = getDbUser(c);
    const booking = await getOwnerBooking(db, dbUser.id, c.req.param("id"));
    if (!booking) return c.json({ error: "not_found" }, 404);
    return c.json({ booking });
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
