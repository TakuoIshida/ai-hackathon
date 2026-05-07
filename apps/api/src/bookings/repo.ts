import { and, desc, eq, gte, ilike, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import type { db as DbClient } from "@/db/client";
import { type Booking as BookingTableRow, bookings } from "@/db/schema/bookings";
import { users } from "@/db/schema/common";
import { availabilityLinks } from "@/db/schema/links";
import type { Booking, BookingDueForReminder, BookingStatus, OwnerBooking } from "./domain";

type Database = typeof DbClient;

/**
 * Drizzle insert shape kept as a repo-internal alias. Not part of the domain
 * vocabulary — only `bookings/repo.ts` (and its sibling test) reach for it,
 * which keeps `bookings/{confirm,cancel,usecase}.ts` Drizzle-free.
 */
export type NewBookingRow = typeof bookings.$inferInsert;

/**
 * Row → domain mapper. Single chokepoint: every read funnels through this so
 * the persistence shape never escapes `repo.ts`. Domain shape happens to mirror
 * the row today, but the indirection lets schema drift stay local.
 */
function toBookingDomain(row: BookingTableRow): Booking {
  return {
    id: row.id,
    linkId: row.linkId,
    hostUserId: row.hostUserId,
    startAt: row.startAt,
    endAt: row.endAt,
    guestName: row.guestName,
    guestEmail: row.guestEmail,
    guestNote: row.guestNote,
    guestTimeZone: row.guestTimeZone,
    // Schema check constraint `status_values` restricts the column to
    // 'confirmed' | 'canceled' at the DB level — narrowing here is safe.
    status: row.status as BookingStatus,
    googleEventId: row.googleEventId,
    googleHtmlLink: row.googleHtmlLink,
    meetUrl: row.meetUrl,
    cancellationToken: row.cancellationToken,
    reminderSentAt: row.reminderSentAt,
    createdAt: row.createdAt,
    canceledAt: row.canceledAt,
  };
}

/**
 * Inserts a confirmed booking, relying on the partial unique index
 * `uniq_bookings_active_slot` (link_id, start_at) WHERE status='confirmed'
 * to atomically reject races with another in-flight confirmation.
 *
 * @returns the inserted booking, or null if another confirmation won the race.
 */
export async function tryInsertConfirmedBooking(
  database: Database,
  input: Omit<NewBookingRow, "id" | "status" | "createdAt"> & { status?: never },
): Promise<Booking | null> {
  const inserted = await database
    .insert(bookings)
    .values({ ...input, status: "confirmed" })
    .onConflictDoNothing({
      target: [bookings.linkId, bookings.startAt],
      where: eq(bookings.status, "confirmed"),
    })
    .returning();
  return inserted[0] ? toBookingDomain(inserted[0]) : null;
}

export async function attachGoogleEvent(
  database: Database,
  bookingId: string,
  googleEventId: string,
  meetUrl: string | null,
  googleHtmlLink: string | null,
): Promise<void> {
  await database
    .update(bookings)
    .set({ googleEventId, meetUrl, googleHtmlLink })
    .where(eq(bookings.id, bookingId));
}

export async function findBookingById(
  database: Database,
  bookingId: string,
): Promise<Booking | null> {
  const [row] = await database.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return row ? toBookingDomain(row) : null;
}

export async function findActiveBookingsForLink(
  database: Database,
  linkId: string,
): Promise<Booking[]> {
  const rows = await database.select().from(bookings).where(eq(bookings.linkId, linkId));
  return rows.map(toBookingDomain);
}

/**
 * ISH-268: server-side search / status filter / pagination for the owner
 * "My bookings" list. The route handler had previously fetched the full
 * unfiltered set and the FE filtered + sliced it client-side; that does not
 * scale past a few hundred bookings.
 *
 * `q` does a case-insensitive OR match against guestName / guestEmail /
 * linkTitle (drizzle `ilike` → Postgres ILIKE with `%q%`). `status` filters
 * the booking row directly.
 *
 * `total` is computed via a window function (`count(*) OVER()`) so it runs
 * in the same plan as the page slice — avoids the round-trip + connection
 * overhead of a separate COUNT(*) query, and we don't hit serialization
 * skew between the two.
 */
export type FindOwnerBookingsParams = {
  q?: string;
  status?: BookingStatus;
  /** 0-based offset (already converted from 1-based page in the usecase). */
  offset: number;
  limit: number;
};

export type FindOwnerBookingsPage = {
  bookings: OwnerBooking[];
  total: number;
};

export async function findBookingsByOwnerPaged(
  database: Database,
  ownerId: string,
  params: FindOwnerBookingsParams,
): Promise<FindOwnerBookingsPage> {
  const filters: SQL[] = [eq(availabilityLinks.userId, ownerId)];
  if (params.status) {
    filters.push(eq(bookings.status, params.status));
  }
  if (params.q && params.q.trim().length > 0) {
    const needle = `%${params.q.trim()}%`;
    const search = or(
      ilike(bookings.guestName, needle),
      ilike(bookings.guestEmail, needle),
      ilike(availabilityLinks.title, needle),
    );
    if (search) filters.push(search);
  }

  const rows = await database
    .select({
      booking: bookings,
      linkSlug: availabilityLinks.slug,
      linkTitle: availabilityLinks.title,
      // ISH-267: host display fields, joined via the denormalized
      // bookings.host_user_id → common.users PK. INNER JOIN is safe because
      // host_user_id is NOT NULL and references users.id with ON DELETE
      // RESTRICT (a host user cannot be deleted while their bookings exist).
      hostName: users.name,
      hostEmail: users.email,
      // ISH-268: window-function count over the filtered set, computed in the
      // same plan as the page slice.
      total: sql<number>`count(*) OVER()`.mapWith(Number),
    })
    .from(bookings)
    .innerJoin(availabilityLinks, eq(bookings.linkId, availabilityLinks.id))
    .innerJoin(users, eq(bookings.hostUserId, users.id))
    .where(and(...filters))
    .orderBy(desc(bookings.startAt))
    .limit(params.limit)
    .offset(params.offset);

  const total = rows[0]?.total ?? 0;
  const items = rows.map((r) => ({
    ...toBookingDomain(r.booking),
    linkSlug: r.linkSlug,
    linkTitle: r.linkTitle,
    // `users.name` is nullable in the DB but the dashboard wants a non-null
    // string for rendering — fall back to the email's local-part so the
    // "主催者" Card never shows blank.
    hostName: r.hostName ?? r.hostEmail.split("@")[0] ?? r.hostEmail,
    hostEmail: r.hostEmail,
  }));
  return { bookings: items, total };
}

/**
 * Returns a single booking by id IFF its parent link is owned by `ownerId`,
 * joined with the link's slug + title (same shape as `findBookingsByOwnerPaged`).
 * Used by GET /bookings/:id (ISH-254) so the detail screen can fetch one row
 * directly instead of paging the whole list and filtering client-side.
 *
 * The `availabilityLinks.userId === ownerId` predicate enforces ownership at
 * the SQL layer — even with RLS already filtering by tenant, we must still
 * gate by primary owner here (other co-owners under the same tenant must
 * not see each other's bookings via this endpoint). Mirrors the explicit
 * ownership check in `cancelBookingByOwner`.
 */
export async function findOwnerBookingById(
  database: Database,
  ownerId: string,
  bookingId: string,
): Promise<OwnerBooking | null> {
  const [row] = await database
    .select({
      booking: bookings,
      linkSlug: availabilityLinks.slug,
      linkTitle: availabilityLinks.title,
      // ISH-267: same JOIN pattern as `findBookingsByOwner` — host display
      // fields come from common.users via bookings.host_user_id.
      hostName: users.name,
      hostEmail: users.email,
    })
    .from(bookings)
    .innerJoin(availabilityLinks, eq(bookings.linkId, availabilityLinks.id))
    .innerJoin(users, eq(bookings.hostUserId, users.id))
    .where(and(eq(bookings.id, bookingId), eq(availabilityLinks.userId, ownerId)))
    .limit(1);
  if (!row) return null;
  return {
    ...toBookingDomain(row.booking),
    linkSlug: row.linkSlug,
    linkTitle: row.linkTitle,
    hostName: row.hostName ?? row.hostEmail.split("@")[0] ?? row.hostEmail,
    hostEmail: row.hostEmail,
  };
}

export async function findBookingByCancellationToken(
  database: Database,
  token: string,
): Promise<Booking | null> {
  const [row] = await database
    .select()
    .from(bookings)
    .where(eq(bookings.cancellationToken, token))
    .limit(1);
  return row ? toBookingDomain(row) : null;
}

/**
 * Marks a confirmed booking as canceled. Idempotent: if the booking is already
 * canceled, returns null so the caller can still respond 200 / skip side effects.
 */
export async function markBookingCanceled(
  database: Database,
  bookingId: string,
): Promise<Booking | null> {
  const [row] = await database
    .update(bookings)
    .set({ status: "canceled", canceledAt: new Date() })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed")))
    .returning();
  return row ? toBookingDomain(row) : null;
}

// ---------- ISH-98: reminder cron ----------

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
 *
 * INNER JOINs to `availability_links` and `users` are safe: bookings.link_id
 * is `ON DELETE RESTRICT` and links.user_id is `ON DELETE CASCADE`, so a
 * confirmed booking always has a live link + owner.
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
      linkTitle: availabilityLinks.title,
      linkDescription: availabilityLinks.description,
      linkTimeZone: availabilityLinks.timeZone,
      ownerEmail: users.email,
      ownerName: users.name,
    })
    .from(bookings)
    .innerJoin(availabilityLinks, eq(bookings.linkId, availabilityLinks.id))
    .innerJoin(users, eq(availabilityLinks.userId, users.id))
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
