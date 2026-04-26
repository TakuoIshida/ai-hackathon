import type { db as DbClient } from "@/db/client";
import type { CreatedEvent, EventCreateInput } from "@/google/calendar";
import type { GoogleConfig } from "@/google/config";
import { getOauthAccountByUser, listUserCalendars } from "@/google/repo";
import { type LinkWithRelations, listLinkCoOwnerUserIds } from "@/links/repo";
import { computePublicSlots } from "@/links/usecase";
import type { BookingNotifier } from "@/notifications/types";
import { getUserById } from "@/users/usecase";
import { attachGoogleEvent, type BookingRow, tryInsertConfirmedBooking } from "./repo";
import type { BookingInput } from "./schemas";

type Database = typeof DbClient;

export type CreateEventFn = (input: EventCreateInput) => Promise<CreatedEvent>;
export type GetAccessTokenFn = (
  database: Database,
  cfg: GoogleConfig,
  oauthAccountId: string,
) => Promise<string>;

export type GoogleSinks = {
  cfg: GoogleConfig | null;
  createEvent: CreateEventFn;
  getAccessToken: GetAccessTokenFn;
};

/**
 * Presentation port for booking notifications (ISH-123). The usecase only
 * publishes domain events; the adapter (see `@/notifications/booking-notifier`)
 * decides how to deliver them. Wrapped naming for backward compatibility with
 * existing `NotificationSinks` callsites — the field name `notifier` keeps the
 * dependency-shape pattern used by `GoogleSinks`.
 */
export type NotificationSinks = {
  notifier: BookingNotifier;
};

export type ConfirmResult =
  | { kind: "ok"; booking: BookingRow }
  | { kind: "slot_unavailable" }
  | { kind: "race_lost" };

export type ConfirmInput = BookingInput & { startMs: number };

/**
 * Atomically confirm a booking for a published availability link.
 *
 * Concurrency guard (ISH-89): the bookings.uniq_bookings_active_slot partial
 * unique index on (link_id, start_at) WHERE status='confirmed' makes the INSERT
 * atomic — a second concurrent caller for the same slot gets ON CONFLICT DO
 * NOTHING and returns null (kind:"race_lost"). Cancelations free the slot.
 *
 * Availability re-check happens *before* the INSERT but the unique index is
 * what actually rules out races; the re-check just gives a cleaner 410 on
 * stale slots that drifted into a busy interval since the page loaded.
 */
export async function confirmBooking(
  database: Database,
  link: LinkWithRelations,
  input: ConfirmInput,
  google: GoogleSinks,
  notifications: NotificationSinks,
): Promise<ConfirmResult> {
  const startMs = input.startMs;
  const endMs = startMs + link.durationMinutes * 60_000;

  // Re-compute slots over a window wide enough that the day's availability
  // window is not clamped — clamping would shift the slot grid anchor and make
  // valid slots look unavailable. ±24h around the requested start fully covers
  // the local day in any IANA timezone.
  const result = await computePublicSlots(database, link, {
    fromMs: startMs - 24 * 60 * 60_000,
    toMs: startMs + 24 * 60 * 60_000,
  });
  const stillAvailable = result.slots.some((s) => s.start === startMs && s.end === endMs);
  if (!stillAvailable) {
    return { kind: "slot_unavailable" };
  }

  const inserted = await tryInsertConfirmedBooking(database, {
    linkId: link.id,
    startAt: new Date(startMs),
    endAt: new Date(endMs),
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestNote: input.guestNote ?? null,
    guestTimeZone: input.guestTimeZone ?? null,
  });
  if (!inserted) return { kind: "race_lost" };

  let booking = inserted;

  // Best-effort Google Calendar sync. If it fails the booking still stands
  // (the operator can manually add the event); we log + continue without Meet.
  //
  // ISH-112: when the link has co-owners, the event is still created on the
  // primary owner's calendar, but ALL owners are invited as attendees so the
  // event appears on each of their calendars natively (Google fans it out
  // via attendee invites — no need for N separate insert calls).
  if (google.cfg) {
    try {
      const account = await getOauthAccountByUser(database, link.userId);
      if (account) {
        const calendars = await listUserCalendars(database, account.id);
        const writeTarget = calendars.find((c) => c.usedForWrites) ?? calendars[0];
        if (writeTarget) {
          const coOwnerIds = await listLinkCoOwnerUserIds(database, link.id);
          const ownerEmails: string[] = [];
          for (const ownerId of coOwnerIds) {
            const u = await getUserById(database, ownerId);
            if (u) ownerEmails.push(u.email);
          }
          const accessToken = await google.getAccessToken(database, google.cfg, account.id);
          const created = await google.createEvent({
            accessToken,
            calendarId: writeTarget.googleCalendarId,
            startMs,
            endMs,
            timeZone: link.timeZone,
            title: link.title,
            description: link.description ?? undefined,
            attendees: [
              { email: input.guestEmail, displayName: input.guestName },
              ...ownerEmails.map((email) => ({ email })),
            ],
            generateMeetUrl: true,
          });
          await attachGoogleEvent(database, inserted.id, created.id, created.meetUrl ?? null);
          booking = {
            ...inserted,
            googleEventId: created.id,
            meetUrl: created.meetUrl ?? null,
          };
        }
      }
    } catch (err) {
      console.warn("[booking] google calendar sync failed; booking kept without event:", err);
    }
  }

  // Best-effort notification. Same policy: log on failure, do not roll back
  // the booking. The presentation concern (templates / transport) lives in
  // the notifier adapter — the usecase only publishes the domain event.
  // ISH-91/92/93/96 — owner + guest confirm.
  try {
    const owner = await getUserById(database, link.userId);
    if (owner) {
      await notifications.notifier.notify({
        kind: "booking_confirmed",
        booking,
        link: {
          id: link.id,
          title: link.title,
          description: link.description,
          timeZone: link.timeZone,
        },
        owner: { email: owner.email, name: owner.name },
        cancellationToken: booking.cancellationToken,
      });
    }
  } catch (err) {
    console.warn("[booking] confirmation notification failed:", err);
  }

  return { kind: "ok", booking };
}
