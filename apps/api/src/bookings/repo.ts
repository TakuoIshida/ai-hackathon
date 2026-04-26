import { and, desc, eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { bookings } from "@/db/schema/bookings";
import { availabilityLinks } from "@/db/schema/links";

type Database = typeof DbClient;

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;

/**
 * Booking row joined with the parent link's slug + title. Used by the owner
 * "My bookings" list view so the response can include link metadata in a
 * single round trip without N+1 lookups in the route handler.
 */
export type BookingWithLinkRow = BookingRow & {
  linkSlug: string;
  linkTitle: string;
};

/**
 * Inserts a confirmed booking, relying on the partial unique index
 * `uniq_bookings_active_slot` (link_id, start_at) WHERE status='confirmed'
 * to atomically reject races with another in-flight confirmation.
 *
 * @returns the inserted row, or null if another confirmation won the race.
 */
export async function tryInsertConfirmedBooking(
  database: Database,
  input: Omit<NewBookingRow, "id" | "status" | "createdAt"> & { status?: never },
): Promise<BookingRow | null> {
  const inserted = await database
    .insert(bookings)
    .values({ ...input, status: "confirmed" })
    .onConflictDoNothing({
      target: [bookings.linkId, bookings.startAt],
      where: eq(bookings.status, "confirmed"),
    })
    .returning();
  return inserted[0] ?? null;
}

export async function attachGoogleEvent(
  database: Database,
  bookingId: string,
  googleEventId: string,
  meetUrl: string | null,
): Promise<void> {
  await database.update(bookings).set({ googleEventId, meetUrl }).where(eq(bookings.id, bookingId));
}

export async function findBookingById(
  database: Database,
  bookingId: string,
): Promise<BookingRow | null> {
  const [row] = await database.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return row ?? null;
}

export async function findActiveBookingsForLink(
  database: Database,
  linkId: string,
): Promise<BookingRow[]> {
  return database.select().from(bookings).where(eq(bookings.linkId, linkId));
}

/**
 * Returns all bookings whose parent link is owned by `ownerId`, joined with
 * the link's slug + title for response rendering. Sorted by `startAt` desc
 * so the list view shows newest first.
 *
 * NOTE: ISH-112 introduces co-owners via the `link_owners` table, but this
 * query intentionally only follows `availability_links.user_id` (the primary
 * owner) to preserve existing behavior — the previous route handler also
 * scoped only to `availabilityLinks.userId`.
 */
export async function findBookingsByOwner(
  database: Database,
  ownerId: string,
): Promise<BookingWithLinkRow[]> {
  const rows = await database
    .select({
      booking: bookings,
      linkSlug: availabilityLinks.slug,
      linkTitle: availabilityLinks.title,
    })
    .from(bookings)
    .innerJoin(availabilityLinks, eq(bookings.linkId, availabilityLinks.id))
    .where(eq(availabilityLinks.userId, ownerId))
    .orderBy(desc(bookings.startAt));
  return rows.map((r) => ({ ...r.booking, linkSlug: r.linkSlug, linkTitle: r.linkTitle }));
}

export async function findBookingByCancellationToken(
  database: Database,
  token: string,
): Promise<BookingRow | null> {
  const [row] = await database
    .select()
    .from(bookings)
    .where(eq(bookings.cancellationToken, token))
    .limit(1);
  return row ?? null;
}

/**
 * Marks a confirmed booking as canceled. Idempotent: if the booking is already
 * canceled, returns null so the caller can still respond 200 / skip side effects.
 */
export async function markBookingCanceled(
  database: Database,
  bookingId: string,
): Promise<BookingRow | null> {
  const [row] = await database
    .update(bookings)
    .set({ status: "canceled", canceledAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed")))
    .returning();
  return row ?? null;
}
