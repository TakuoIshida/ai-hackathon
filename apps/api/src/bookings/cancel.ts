import type { db as DbClient } from "@/db/client";
import type { GooglePort, Link, LinkLookupPort, NotificationPort, UserLookupPort } from "@/ports";
import type { Booking } from "./domain";
import { findBookingByCancellationToken, findBookingById, markBookingCanceled } from "./repo";

type Database = typeof DbClient;

/**
 * Cross-feature dependencies for cancellation. Same shape as
 * `ConfirmBookingPorts` minus `availability` (cancel doesn't re-check the
 * slot grid). `google === null` means Google is disabled and the calendar
 * delete step is skipped.
 */
export type CancelBookingPorts = {
  google: GooglePort | null;
  links: LinkLookupPort;
  users: UserLookupPort;
  notifier: NotificationPort;
};

export type CancelActor = "owner" | "guest";

export type CancelResult =
  | { kind: "ok"; booking: Booking }
  | { kind: "not_found" }
  | { kind: "already_canceled" };

async function fireCancelSideEffects(
  booking: Booking,
  canceledBy: CancelActor,
  link: Link,
  ports: CancelBookingPorts,
): Promise<void> {
  // Best-effort Google Calendar event delete.
  if (ports.google && booking.googleEventId) {
    try {
      const account = await ports.google.getOauthAccountByUser(link.userId);
      if (account) {
        const calendars = await ports.google.listUserCalendars(account.id);
        const writeTarget = calendars.find((c) => c.usedForWrites) ?? calendars[0];
        if (writeTarget) {
          const accessToken = await ports.google.getValidAccessToken(account.id);
          await ports.google.deleteEvent({
            accessToken,
            calendarId: writeTarget.googleCalendarId,
            eventId: booking.googleEventId,
          });
        }
      }
    } catch (err) {
      console.warn("[cancel] google calendar delete failed:", err);
    }
  }

  // Best-effort cancel notification. Templates / transport are owned by the
  // notifier adapter — usecase only publishes the domain event.
  try {
    const owner = await ports.users.findUserById(link.userId);
    if (owner) {
      await ports.notifier.notify({
        kind: "booking_canceled",
        booking,
        link: {
          id: link.id,
          title: link.title,
          description: link.description,
          timeZone: link.timeZone,
        },
        owner: { email: owner.email, name: owner.name },
        cancellationToken: booking.cancellationToken,
        canceledBy,
      });
    }
  } catch (err) {
    console.warn("[cancel] cancel notification failed:", err);
  }
}

export async function cancelBookingByToken(
  database: Database,
  token: string,
  ports: CancelBookingPorts,
): Promise<CancelResult> {
  const booking = await findBookingByCancellationToken(database, token);
  if (!booking) return { kind: "not_found" };
  if (booking.status === "canceled") return { kind: "already_canceled" };

  const canceled = await markBookingCanceled(database, booking.id);
  if (!canceled) return { kind: "already_canceled" };

  const link = await ports.links.findLinkById(canceled.linkId);
  if (link) await fireCancelSideEffects(canceled, "guest", link, ports);
  return { kind: "ok", booking: canceled };
}

export async function cancelBookingByOwner(
  database: Database,
  bookingId: string,
  ownerUserId: string,
  ports: CancelBookingPorts,
): Promise<CancelResult> {
  const booking = await findBookingById(database, bookingId);
  if (!booking) return { kind: "not_found" };
  // Ownership check via the link. Both primary owner (link.userId) and any
  // registered co-owner are allowed to cancel — confirm.ts puts co-owners on
  // the calendar event as attendees, so cancel must accept the same set
  // (ISH-273).
  const link = await ports.links.findLinkById(booking.linkId);
  if (!link) return { kind: "not_found" };
  const coOwnerIds = await ports.links.listLinkCoOwnerUserIds(link.id);
  if (link.userId !== ownerUserId && !coOwnerIds.includes(ownerUserId)) {
    return { kind: "not_found" };
  }
  if (booking.status === "canceled") return { kind: "already_canceled" };

  const canceled = await markBookingCanceled(database, booking.id);
  if (!canceled) return { kind: "already_canceled" };

  await fireCancelSideEffects(canceled, "owner", link, ports);
  return { kind: "ok", booking: canceled };
}

// Re-export so route handlers can import from one place.
export { findBookingByCancellationToken } from "./repo";
