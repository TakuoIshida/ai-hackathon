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
  startAt: Date;
  endAt: Date;
  guestName: string;
  guestEmail: string;
  guestNote: string | null;
  guestTimeZone: string | null;
  status: BookingStatus | string;
  googleEventId: string | null;
  meetUrl: string | null;
  cancellationToken: string;
  reminderSentAt: Date | null;
  createdAt: Date;
  canceledAt: Date | null;
};

/**
 * Booking joined with the parent link's slug + title. Returned by the owner
 * "My bookings" list view so the response can include link metadata in a
 * single round trip without N+1 lookups in the route handler.
 */
export type OwnerBooking = Booking & {
  linkSlug: string;
  linkTitle: string;
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
