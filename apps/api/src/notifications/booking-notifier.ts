import {
  guestCancelEmail,
  guestConfirmEmail,
  ownerCancelEmail,
  ownerConfirmEmail,
} from "./templates";
import type {
  BookingCanceledEvent,
  BookingConfirmedEvent,
  BookingEvent,
  BookingNotifier,
  SendEmailFn,
} from "./types";

export type BookingNotifierDeps = {
  sendEmail: SendEmailFn;
  appBaseUrl: string;
};

/**
 * Default presentation adapter for booking domain events (ISH-123).
 *
 * Builds the email bodies from `notifications/templates` and dispatches them
 * via `sendEmail`. Errors propagate to the caller; the usecase wraps
 * `notifier.notify(...)` in a try/catch so a transient SMTP failure never
 * rolls back a confirmed/canceled booking.
 */
export function createBookingNotifier(deps: BookingNotifierDeps): BookingNotifier {
  const { sendEmail, appBaseUrl } = deps;
  return {
    async notify(event: BookingEvent): Promise<void> {
      switch (event.kind) {
        case "booking_confirmed":
          await dispatchConfirmed(event, sendEmail, appBaseUrl);
          return;
        case "booking_canceled":
          await dispatchCanceled(event, sendEmail, appBaseUrl);
          return;
      }
    },
  };
}

async function dispatchConfirmed(
  event: BookingConfirmedEvent,
  sendEmail: SendEmailFn,
  appBaseUrl: string,
): Promise<void> {
  const ctx = {
    linkTitle: event.link.title,
    linkDescription: event.link.description,
    startAt: event.booking.startAt,
    endAt: event.booking.endAt,
    ownerEmail: event.owner.email,
    ownerName: event.owner.name,
    guestEmail: event.booking.guestEmail,
    guestName: event.booking.guestName,
    guestNote: event.booking.guestNote,
    guestTimeZone: event.booking.guestTimeZone,
    ownerTimeZone: event.link.timeZone,
    meetUrl: event.booking.meetUrl,
    cancelUrl: `${appBaseUrl}/cancel/${event.cancellationToken}`,
  };
  await Promise.all([sendEmail(ownerConfirmEmail(ctx)), sendEmail(guestConfirmEmail(ctx))]);
}

async function dispatchCanceled(
  event: BookingCanceledEvent,
  sendEmail: SendEmailFn,
  appBaseUrl: string,
): Promise<void> {
  const ctx = {
    linkTitle: event.link.title,
    linkDescription: event.link.description,
    startAt: event.booking.startAt,
    endAt: event.booking.endAt,
    ownerEmail: event.owner.email,
    ownerName: event.owner.name,
    guestEmail: event.booking.guestEmail,
    guestName: event.booking.guestName,
    guestNote: event.booking.guestNote,
    guestTimeZone: event.booking.guestTimeZone,
    ownerTimeZone: event.link.timeZone,
    meetUrl: event.booking.meetUrl,
    cancelUrl: `${appBaseUrl}/cancel/${event.cancellationToken}`,
    canceledBy: event.canceledBy,
  };
  await Promise.all([sendEmail(ownerCancelEmail(ctx)), sendEmail(guestCancelEmail(ctx))]);
}
