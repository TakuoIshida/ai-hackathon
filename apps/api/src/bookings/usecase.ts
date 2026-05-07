import type { db as DbClient } from "@/db/client";
import type { BookingStatus } from "./domain";
import { findBookingsByOwnerPaged, findOwnerBookingById } from "./repo";

type Database = typeof DbClient;

/**
 * Domain shape returned by the bookings list/detail use cases. Intentionally
 * a thin mapping of the joined repo row — keeps route handlers free of
 * Drizzle row internals while preserving the existing GET /bookings response
 * contract (field names + types unchanged).
 */
export type OwnerBookingView = {
  id: string;
  linkId: string;
  linkTitle: string;
  linkSlug: string;
  // ISH-267: host info pass-through. The dashboard list / detail screens
  // render these directly so no further name/email resolution happens at the
  // route layer.
  hostUserId: string;
  hostName: string;
  hostEmail: string;
  startAt: Date;
  endAt: Date;
  guestName: string;
  guestEmail: string;
  status: string;
  meetUrl: string | null;
  /**
   * Google Calendar `event.id` saved at confirm-time. Null when Google sync
   * was skipped or failed (best-effort policy in `confirmBooking`).
   */
  googleEventId: string | null;
  /**
   * Google Calendar `event.htmlLink` saved at confirm-time — the deep link
   * used by the booking detail "Google Calendar で開く" button (ISH-269).
   * Null when Google sync was skipped or failed.
   */
  googleHtmlLink: string | null;
  canceledAt: Date | null;
  createdAt: Date;
};

/**
 * ISH-268: server-side paged listing of bookings owned by `ownerId` (i.e.
 * bookings under links whose `userId === ownerId`), sorted by start time
 * descending. Replaces the previous "fetch all, filter+slice on the FE"
 * pattern with a single SQL round trip that already applies search / status
 * / pagination at the DB, so first-paint payload stays bounded as the
 * booking count grows.
 *
 * `page` is 1-based (matches the typical UI control); we translate to
 * `offset = (page - 1) * pageSize` here so the repo layer stays SQL-shaped.
 *
 * `total` is the matching count BEFORE limit/offset — used by the FE to
 * render "全 N 件中 a–b 件" and disable next/prev appropriately.
 */
export type ListOwnerBookingsPagedParams = {
  q?: string;
  status?: BookingStatus;
  page: number;
  pageSize: number;
};

export type ListOwnerBookingsPagedResult = {
  bookings: OwnerBookingView[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listOwnerBookingsPaged(
  database: Database,
  ownerId: string,
  params: ListOwnerBookingsPagedParams,
): Promise<ListOwnerBookingsPagedResult> {
  const offset = (params.page - 1) * params.pageSize;
  const { bookings: rows, total } = await findBookingsByOwnerPaged(database, ownerId, {
    q: params.q,
    status: params.status,
    offset,
    limit: params.pageSize,
  });
  return {
    bookings: rows.map((b) => ({
      id: b.id,
      linkId: b.linkId,
      linkTitle: b.linkTitle,
      linkSlug: b.linkSlug,
      hostUserId: b.hostUserId,
      hostName: b.hostName,
      hostEmail: b.hostEmail,
      startAt: b.startAt,
      endAt: b.endAt,
      guestName: b.guestName,
      guestEmail: b.guestEmail,
      status: b.status,
      meetUrl: b.meetUrl,
      googleEventId: b.googleEventId,
      googleHtmlLink: b.googleHtmlLink,
      canceledAt: b.canceledAt,
      createdAt: b.createdAt,
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/**
 * Returns a single owner-scoped booking view (same projection as
 * `listOwnerBookingsPaged`) or null if no booking with `bookingId` exists OR the
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
    hostUserId: b.hostUserId,
    hostName: b.hostName,
    hostEmail: b.hostEmail,
    startAt: b.startAt,
    endAt: b.endAt,
    guestName: b.guestName,
    guestEmail: b.guestEmail,
    status: b.status,
    meetUrl: b.meetUrl,
    googleEventId: b.googleEventId,
    googleHtmlLink: b.googleHtmlLink,
    canceledAt: b.canceledAt,
    createdAt: b.createdAt,
  };
}
