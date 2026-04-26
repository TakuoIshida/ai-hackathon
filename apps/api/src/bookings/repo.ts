import { eq } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { bookings } from "@/db/schema/bookings";

type Database = typeof DbClient;

export type BookingRow = typeof bookings.$inferSelect;
export type NewBookingRow = typeof bookings.$inferInsert;

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
