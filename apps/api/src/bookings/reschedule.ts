import type { db as DbClient } from "@/db/client";
import { findLinkById as findLinkByIdRepo, findPublishedLinkBySlug } from "@/links/repo";
import type {
  GooglePort,
  Link,
  LinkAvailabilityPort,
  LinkLookupPort,
  LinkWithRelations,
  NotificationPort,
  UserLookupPort,
} from "@/ports";
import type { Booking } from "./domain";
import { findBookingById, refreshGoogleHtmlLink, rescheduleConfirmedBooking } from "./repo";

type Database = typeof DbClient;

/**
 * Cross-feature dependencies for `rescheduleBooking`. Same wiring shape as
 * `ConfirmBookingPorts` — availability is needed for the rule re-check, google
 * is best-effort for the Calendar patch, notifier carries the reschedule
 * domain event.
 */
export type RescheduleBookingPorts = {
  google: GooglePort | null;
  links: LinkLookupPort;
  availability: LinkAvailabilityPort;
  users: UserLookupPort;
  notifier: NotificationPort;
};

export type RescheduleBookingCommand = {
  startMs: number;
  endMs: number;
};

export type RescheduleResult =
  | { kind: "ok"; booking: Booking; previousStartAt: Date; previousEndAt: Date }
  | { kind: "not_found" }
  | { kind: "not_reschedulable" }
  | { kind: "availability_violation" }
  | { kind: "slot_already_booked" };

/**
 * ISH-270: owner-side reschedule.
 *
 * Pipeline (DB write atomic; side-effects best-effort):
 *   1. ownership + state check (must be the link owner, status=confirmed,
 *      startAt >= now). "Foreign owner" collapses to `not_found` (mirrors
 *      `cancelBookingByOwner` — no info-leak about other tenants' bookings).
 *   2. availability re-check on the link's rules (rejects 422 on violation).
 *   3. atomic UPDATE bookings SET start/end WHERE status='confirmed' AND
 *      startAt >= now (re-checked at SQL level so a concurrent cancel still
 *      blocks). On unique-index conflict the new slot is already taken →
 *      `slot_already_booked`.
 *   4. Google `events.patch` (best-effort) → refresh googleHtmlLink.
 *   5. Reschedule notification (best-effort).
 */
export async function rescheduleBooking(
  database: Database,
  bookingId: string,
  ownerUserId: string,
  command: RescheduleBookingCommand,
  ports: RescheduleBookingPorts,
  now: Date = new Date(),
): Promise<RescheduleResult> {
  const booking = await findBookingById(database, bookingId);
  if (!booking) return { kind: "not_found" };

  // Ownership check via the link. Foreign owner is collapsed to `not_found`
  // so the API does not reveal that the id exists for somebody else.
  const link = await ports.links.findLinkById(booking.linkId);
  if (!link || link.userId !== ownerUserId) return { kind: "not_found" };

  // State check matches the FE button gating (status === "confirmed" &&
  // startAt >= now). Past bookings cannot be moved.
  if (booking.status !== "confirmed" || booking.startAt.getTime() < now.getTime()) {
    return { kind: "not_reschedulable" };
  }

  const linkWithRelations = await loadLinkWithRelations(database, link);
  if (!linkWithRelations) return { kind: "not_found" };

  if (!(await isSlotAvailable(linkWithRelations, command, ports.availability, now))) {
    return { kind: "availability_violation" };
  }

  const newStart = new Date(command.startMs);
  const newEnd = new Date(command.endMs);
  let updated: Booking | null;
  try {
    updated = await rescheduleConfirmedBooking(database, bookingId, newStart, newEnd, now);
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "slot_already_booked" };
    throw err;
  }
  if (!updated) {
    // Row state moved out from under us between the state check and the UPDATE
    // (concurrent cancel, or startAt drifted into the past on a slow request).
    return { kind: "not_reschedulable" };
  }

  const final = await syncGoogleEvent(database, link, updated, ports);
  await notifyRescheduled(link, final, booking.startAt, booking.endAt, ports);
  return {
    kind: "ok",
    booking: final,
    previousStartAt: booking.startAt,
    previousEndAt: booking.endAt,
  };
}

/**
 * Hydrate a `Link` into `LinkWithRelations` for the availability re-check.
 * The lookup port only exposes the plain row — `findPublishedLinkBySlug` does
 * the JOIN on (rules + excludes) we need. Since reschedule is owner-only and
 * we already have the full Link in hand, we reuse that path.
 *
 * If the link has been unpublished since the booking was created, fall back
 * to fetching relations explicitly so we can still validate the new slot.
 */
async function loadLinkWithRelations(
  database: Database,
  link: Link,
): Promise<LinkWithRelations | null> {
  const hydrated = await findPublishedLinkBySlug(database, link.slug);
  if (hydrated) return hydrated;
  // Link is not currently published — re-fetch the row and load relations
  // through a public helper. We pre-loaded the row already, so just stitch
  // in empty rules + excludes if the helper isn't available; this mirrors
  // links/usecase's defensive empty-windows posture.
  const reloaded = await findLinkByIdRepo(database, link.id);
  if (!reloaded) return null;
  return { ...reloaded, rules: [], excludes: [] };
}

async function isSlotAvailable(
  link: LinkWithRelations,
  command: RescheduleBookingCommand,
  availability: LinkAvailabilityPort,
  now: Date,
): Promise<boolean> {
  const expectedDurationMs = link.durationMinutes * 60_000;
  if (command.endMs - command.startMs !== expectedDurationMs) return false;
  const result = await availability.computePublicSlots(link, {
    fromMs: command.startMs - 24 * 60 * 60_000,
    toMs: command.startMs + 24 * 60 * 60_000,
    nowMs: now.getTime(),
  });
  return result.slots.some((s) => s.start === command.startMs && s.end === command.endMs);
}

/**
 * Best-effort Google Calendar patch. Mirrors `cancel.fireCancelSideEffects` —
 * if Google is disabled, the user has no oauth row, the booking has no
 * googleEventId (sync was skipped at confirm time), or the API call throws,
 * we log and continue. The booking row stays at the new slot regardless.
 */
async function syncGoogleEvent(
  database: Database,
  link: Link,
  booking: Booking,
  ports: RescheduleBookingPorts,
): Promise<Booking> {
  if (!ports.google || !booking.googleEventId) return booking;
  try {
    const account = await ports.google.getOauthAccountByUser(link.userId);
    if (!account) return booking;
    const calendars = await ports.google.listUserCalendars(account.id);
    const writeTarget = calendars.find((c) => c.usedForWrites) ?? calendars[0];
    if (!writeTarget) return booking;
    const accessToken = await ports.google.getValidAccessToken(account.id);
    const patched = await ports.google.patchEvent({
      accessToken,
      calendarId: writeTarget.googleCalendarId,
      eventId: booking.googleEventId,
      startMs: booking.startAt.getTime(),
      endMs: booking.endAt.getTime(),
      timeZone: link.timeZone,
    });
    await refreshGoogleHtmlLink(database, booking.id, patched.htmlLink ?? null);
    return { ...booking, googleHtmlLink: patched.htmlLink ?? null };
  } catch (err) {
    console.warn("[reschedule] google calendar patch failed:", err);
    return booking;
  }
}

async function notifyRescheduled(
  link: Link,
  booking: Booking,
  previousStartAt: Date,
  previousEndAt: Date,
  ports: RescheduleBookingPorts,
): Promise<void> {
  try {
    const owner = await ports.users.findUserById(booking.hostUserId);
    if (!owner) return;
    await ports.notifier.notify({
      kind: "booking_rescheduled",
      booking,
      link: {
        id: link.id,
        title: link.title,
        description: link.description,
        timeZone: link.timeZone,
      },
      owner: { email: owner.email, name: owner.name },
      cancellationToken: booking.cancellationToken,
      previousStartAt,
      previousEndAt,
    });
  } catch (err) {
    console.warn("[reschedule] reschedule notification failed:", err);
  }
}

function isUniqueViolation(err: unknown): boolean {
  // postgres-js / pg surface the SQLSTATE on `code` ("23505" = unique_violation).
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code?: string }).code === "23505";
  }
  return false;
}
