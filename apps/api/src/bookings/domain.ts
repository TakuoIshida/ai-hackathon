/**
 * Pure-domain booking. The shape mirrors the on-disk row only because the
 * persistence schema happens to fit the domain — `repo.ts` still owns the
 * row→domain mapping (`toBookingDomain`) so future schema changes don't
 * silently propagate into usecase / route layers (ISH-120).
 *
 * No imports from `drizzle-orm` or `@/db/schema/*` — that boundary is enforced
 * by structure: only `bookings/repo.ts` may turn rows into `Booking`.
 */
export type BookingStatus = "confirmed" | "canceled";

export type Booking = {
  id: string;
  linkId: string;
  // ISH-267: persisted host (owner) reference. The list / detail endpoints
  // resolve this to name + email via a JOIN — see `OwnerBooking`. Populated at
  // insert with the parent link's primary owner user id.
  hostUserId: string;
  startAt: Date;
  endAt: Date;
  guestName: string;
  guestEmail: string;
  guestNote: string | null;
  guestTimeZone: string | null;
  status: BookingStatus;
  googleEventId: string | null;
  meetUrl: string | null;
  cancellationToken: string;
  reminderSentAt: Date | null;
  createdAt: Date;
  canceledAt: Date | null;
};

/**
 * Booking joined with the parent link's slug + title and the host user's
 * display fields. Returned by the owner "My bookings" list view so the
 * response can include host + link metadata in a single round trip without
 * N+1 lookups in the route handler. ISH-267 added the host fields so the
 * dashboard can stop hard-coding "あなた" / "このワークスペースのオーナー".
 */
export type OwnerBooking = Booking & {
  linkSlug: string;
  linkTitle: string;
  hostName: string;
  hostEmail: string;
};

/**
 * Domain command for confirming a booking. Carries the resolved start
 * timestamp (parsed at the route boundary) plus the guest fields. Decoupled
 * from `bookingInputSchema` so `confirm.ts` does not import Zod (ISH-124).
 */
export type ConfirmBookingCommand = {
  startMs: number;
  guestName: string;
  guestEmail: string;
  guestNote: string | null;
  guestTimeZone: string | null;
};

/**
 * Projection used by the reminder cron (ISH-149). Intentionally already a
 * "wide row" — the cron does not need a real `Booking` because the JOIN
 * pre-bakes the only fields it consumes (link title/desc/tz, owner email/name).
 */
export type BookingDueForReminder = {
  bookingId: string;
  linkId: string;
  startAt: Date;
  endAt: Date;
  guestEmail: string;
  guestName: string;
  guestTimeZone: string | null;
  meetUrl: string | null;
  cancellationToken: string;
  linkTitle: string;
  linkDescription: string | null;
  linkTimeZone: string;
  ownerEmail: string;
  ownerName: string | null;
};
