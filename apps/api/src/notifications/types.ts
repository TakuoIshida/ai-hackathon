import type { BookingRow } from "@/bookings/repo";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailFn = (message: EmailMessage) => Promise<void>;

export const noopSendEmail: SendEmailFn = async () => {
  // intentionally empty — used when RESEND_API_KEY is absent so booking confirm
  // still succeeds in dev / unit tests without Resend wired up.
};

// ---------- ISH-123: domain events for booking notifications ----------
//
// The bookings usecase publishes these events to a `BookingNotifier` port; the
// adapter (see ./booking-notifier.ts) is responsible for rendering email bodies
// from templates and dispatching them. This keeps presentation concerns out of
// the usecase — `confirm.ts` / `cancel.ts` only care about the domain fact,
// not how it is delivered.

/** Subset of the parent link carried on a booking event. */
export type BookingEventLink = {
  id: string;
  title: string;
  description: string | null;
  timeZone: string;
};

/** Subset of the owner carried on a booking event. */
export type BookingEventOwner = {
  email: string;
  name: string | null;
};

export type BookingConfirmedEvent = {
  kind: "booking_confirmed";
  booking: BookingRow;
  link: BookingEventLink;
  owner: BookingEventOwner;
  cancellationToken: string;
};

export type BookingCanceledEvent = {
  kind: "booking_canceled";
  booking: BookingRow;
  link: BookingEventLink;
  owner: BookingEventOwner;
  cancellationToken: string;
  canceledBy: "owner" | "guest";
};

export type BookingEvent = BookingConfirmedEvent | BookingCanceledEvent;

/**
 * Presentation port: usecases publish a domain event; the adapter decides
 * how to deliver it (email today, Slack/webhook tomorrow). Implementations
 * are best-effort by contract — the usecase wraps `notify` calls in a
 * try/catch so a delivery failure never rolls back a domain mutation.
 */
export type BookingNotifier = {
  notify(event: BookingEvent): Promise<void>;
};
