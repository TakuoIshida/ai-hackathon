import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { availabilityLinks } from "@/db/schema/links";
import { deleteEvent } from "@/google/calendar";
import { getOauthAccountByUser, listUserCalendars } from "@/google/repo";
import { findPublishedLinkBySlug } from "@/links/repo";
import { getUserById } from "@/users/usecase";
import type { GoogleSinks, NotificationSinks } from "./confirm";
import type { Booking } from "./domain";
import { findBookingByCancellationToken, findBookingById, markBookingCanceled } from "./repo";

type Database = typeof DbClient;

export type CancelActor = "owner" | "guest";

export type CancelResult =
  | { kind: "ok"; booking: Booking }
  | { kind: "not_found" }
  | { kind: "already_canceled" };

async function loadLinkForBooking(database: Database, linkId: string) {
  const [link] = await database
    .select()
    .from(availabilityLinks)
    .where(eq(availabilityLinks.id, linkId))
    .limit(1);
  return link ?? null;
}

async function fireCancelSideEffects(
  database: Database,
  booking: Booking,
  canceledBy: CancelActor,
  google: GoogleSinks,
  notifications: NotificationSinks,
): Promise<void> {
  const link = await loadLinkForBooking(database, booking.linkId);
  if (!link) return;

  // Best-effort Google Calendar event delete.
  if (google.cfg && booking.googleEventId) {
    try {
      const account = await getOauthAccountByUser(database, link.userId);
      if (account) {
        const calendars = await listUserCalendars(database, account.id);
        const writeTarget = calendars.find((c) => c.usedForWrites) ?? calendars[0];
        if (writeTarget) {
          const accessToken = await google.getAccessToken(database, google.cfg, account.id);
          await deleteEvent({
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
    const owner = await getUserById(database, link.userId);
    if (owner) {
      await notifications.notifier.notify({
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
  google: GoogleSinks,
  notifications: NotificationSinks,
): Promise<CancelResult> {
  const booking = await findBookingByCancellationToken(database, token);
  if (!booking) return { kind: "not_found" };
  if (booking.status === "canceled") return { kind: "already_canceled" };

  const canceled = await markBookingCanceled(database, booking.id);
  if (!canceled) return { kind: "already_canceled" };

  await fireCancelSideEffects(database, canceled, "guest", google, notifications);
  return { kind: "ok", booking: canceled };
}

export async function cancelBookingByOwner(
  database: Database,
  bookingId: string,
  ownerUserId: string,
  google: GoogleSinks,
  notifications: NotificationSinks,
): Promise<CancelResult> {
  const booking = await findBookingById(database, bookingId);
  if (!booking) return { kind: "not_found" };
  // ownership check via the link
  const link = await loadLinkForBooking(database, booking.linkId);
  if (!link || link.userId !== ownerUserId) return { kind: "not_found" };
  if (booking.status === "canceled") return { kind: "already_canceled" };

  const canceled = await markBookingCanceled(database, booking.id);
  if (!canceled) return { kind: "already_canceled" };

  await fireCancelSideEffects(database, canceled, "owner", google, notifications);
  return { kind: "ok", booking: canceled };
}

// Re-export so route handlers can import from one place.
export { findBookingByCancellationToken } from "./repo";
export { findPublishedLinkBySlug };
