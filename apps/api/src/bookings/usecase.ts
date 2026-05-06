import type { db as DbClient } from "@/db/client";
import { findBookingsByOwner, findOwnerBookingById } from "./repo";

type Database = typeof DbClient;

/**
 * Domain shape returned by `listOwnerBookings`. Intentionally a thin
 * mapping of the joined repo row — keeps route handlers free of Drizzle
 * row internals while preserving the existing GET /bookings response
 * contract (field names + types unchanged).
 */
export type OwnerBookingView = {
  id: string;
  linkId: string;
  linkTitle: string;
  linkSlug: string;
  startAt: Date;
  endAt: Date;
  guestName: string;
  guestEmail: string;
  status: string;
  meetUrl: string | null;
  canceledAt: Date | null;
  createdAt: Date;
};

export type ListOwnerBookingsFilter = {
  /** When true, only return bookings whose `startAt` is >= now. */
  upcomingOnly?: boolean;
};

/**
 * Lists all bookings owned by `ownerId` (i.e. bookings under links whose
 * `userId === ownerId`), sorted by start time descending.
 *
 * The `filter.upcomingOnly` flag is wired in but currently a no-op pass-through
 * applied in-memory — the repo returns all rows and we slice here. This keeps
 * the SQL surface small while letting future callers opt-in without another
 * round trip.
 */
export async function listOwnerBookings(
  database: Database,
  ownerId: string,
  filter: ListOwnerBookingsFilter = {},
): Promise<OwnerBookingView[]> {
  const rows = await findBookingsByOwner(database, ownerId);
  const filtered = filter.upcomingOnly
    ? rows.filter((b) => b.startAt.getTime() >= Date.now())
    : rows;
  return filtered.map((b) => ({
    id: b.id,
    linkId: b.linkId,
    linkTitle: b.linkTitle,
    linkSlug: b.linkSlug,
    startAt: b.startAt,
    endAt: b.endAt,
    guestName: b.guestName,
    guestEmail: b.guestEmail,
    status: b.status,
    meetUrl: b.meetUrl,
    canceledAt: b.canceledAt,
    createdAt: b.createdAt,
  }));
}

/**
 * Returns a single owner-scoped booking view (same projection as
 * `listOwnerBookings`) or null if no booking with `bookingId` exists OR the
 * booking's parent link is not owned by `ownerId`. Collapsing "missing" and
 * "foreign" into a single null is intentional — the route maps both to 404
 * to avoid leaking the existence of foreign booking ids (ISH-183).
 *
 * RLS already filters by tenant; the explicit `availabilityLinks.userId`
 * predicate inside the repo additionally restricts to the primary owner.
 */
export async function getOwnerBooking(
  database: Database,
  ownerId: string,
  bookingId: string,
): Promise<OwnerBookingView | null> {
  const b = await findOwnerBookingById(database, ownerId, bookingId);
  if (!b) return null;
  return {
    id: b.id,
    linkId: b.linkId,
    linkTitle: b.linkTitle,
    linkSlug: b.linkSlug,
    startAt: b.startAt,
    endAt: b.endAt,
    guestName: b.guestName,
    guestEmail: b.guestEmail,
    status: b.status,
    meetUrl: b.meetUrl,
    canceledAt: b.canceledAt,
    createdAt: b.createdAt,
  };
}
