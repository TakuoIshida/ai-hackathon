import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
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

// ---------- ISH-98: reminder cron ----------

/**
 * Projection used by the reminder cron. Slim by design: the job only needs
 * what `BookingNotificationContext` requires plus the link/booking ids so it
 * can hydrate the link + owner separately.
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
};

/**
 * Confirmed bookings whose start_at falls in [now+leadMs-windowMs, now+leadMs+windowMs)
 * and which have NOT had a reminder sent yet. The cron runs every 15 min so
 * windowMs should be ~ (cron interval / 2) — i.e. 8 min — to ensure each due
 * booking is hit at least once without overlap.
 *
 * Cron jobs are wall-clock-jittery (GitHub schedule fires "best-effort"), so a
 * symmetric window around the lead-time mark catches early/late firings without
 * double-emitting. The `reminder_sent_at IS NULL` clause gives idempotency
 * across overlapping cron runs even before the per-row claim in
 * `markReminderSent` kicks in.
 */
export async function findBookingsDueForReminder(
  database: Database,
  params: { now: Date; leadMs: number; windowMs: number },
): Promise<BookingDueForReminder[]> {
  const target = params.now.getTime() + params.leadMs;
  const lo = new Date(target - params.windowMs);
  const hi = new Date(target + params.windowMs);
  const rows = await database
    .select({
      bookingId: bookings.id,
      linkId: bookings.linkId,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      guestEmail: bookings.guestEmail,
      guestName: bookings.guestName,
      guestTimeZone: bookings.guestTimeZone,
      meetUrl: bookings.meetUrl,
      cancellationToken: bookings.cancellationToken,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "confirmed"),
        isNull(bookings.reminderSentAt),
        gte(bookings.startAt, lo),
        lt(bookings.startAt, hi),
      ),
    );
  return rows;
}

/**
 * Mark a booking's reminder as sent. Idempotent: if reminder_sent_at is
 * already non-null, this is a no-op. Returns true if the row was updated
 * (i.e. the reminder transition happened on this call), false otherwise.
 *
 * Used to enforce single-send semantics even if the cron worker overlaps
 * with another worker for the same row — the partial WHERE clause makes
 * the second UPDATE a no-op rather than a bump. Same pattern as
 * `acceptInvitationAtomic` in workspaces/repo.ts.
 */
export async function markReminderSent(
  database: Database,
  bookingId: string,
  now: Date,
): Promise<boolean> {
  const result = await database
    .update(bookings)
    .set({ reminderSentAt: now })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.reminderSentAt)))
    .returning({ id: bookings.id });
  return result.length > 0;
}
