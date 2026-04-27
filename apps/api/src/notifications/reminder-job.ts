import type { BookingDueForReminder } from "@/bookings/domain";
import { findBookingsDueForReminder, markReminderSent } from "@/bookings/repo";
import type { db as DbClient } from "@/db/client";
import type { BookingNotificationContext } from "./templates";
import { guestReminderEmail, ownerReminderEmail } from "./templates";
import type { SendEmailFn } from "./types";

type Database = typeof DbClient;

/**
 * ISH-98: dependencies for the reminder cron job.
 *
 * `now` / `leadHours` / `windowMinutes` are overridable for tests. In
 * production the CLI entrypoint (`apps/api/src/jobs/reminders.ts`) leaves
 * them at their defaults so the job behavior is fully determined by the
 * cron schedule + the issue's spec.
 */
export type ReminderJobDeps = {
  sendEmail: SendEmailFn;
  appBaseUrl: string;
  /** Defaults to `Date.now`. Override in tests to pin the wall clock. */
  now?: () => number;
  /** Hours before `start_at` at which the reminder should fire. Default: 24. */
  leadHours?: number;
  /**
   * Half-width of the "due window" in minutes. Default: 8 (half of the 15-min
   * cron interval) so each booking is hit by exactly one cron tick.
   */
  windowMinutes?: number;
};

export type ReminderJobResult = {
  /** Total rows fetched from `findBookingsDueForReminder`. */
  considered: number;
  /** `markReminderSent` returned true AND both emails dispatched. */
  sent: number;
  /** `markReminderSent` returned false (already sent / lost the race). */
  skipped: number;
  /** An email or repo call threw. The mark is intentionally NOT rolled back. */
  failed: number;
};

const DEFAULT_LEAD_HOURS = 24;
const DEFAULT_WINDOW_MINUTES = 8;

/**
 * Sends reminder emails for confirmed bookings whose `start_at` falls within
 * `[now + leadHours - windowMinutes, now + leadHours + windowMinutes)` and
 * which have not already had `reminder_sent_at` populated.
 *
 * Per-booking flow (intentionally claim-then-send so the job is idempotent
 * under overlapping cron runs):
 *   1. `markReminderSent(db, id, now)` — atomic claim. Partial WHERE
 *      `reminder_sent_at IS NULL` makes a second UPDATE a no-op.
 *   2. If the claim returned false → skipped.
 *   3. If the claim returned true → render the owner + guest emails directly
 *      from the JOIN-projected fields (ISH-149: no per-booking SELECT) and
 *      send them. On failure we log and count as `failed` BUT do NOT clear
 *      `reminder_sent_at`. Rationale: the issue's hard constraint is
 *      "多重送信されない" (no double-sends); a missed reminder is the
 *      lesser harm. Operators can manually re-trigger by clearing the column
 *      if needed.
 */
export async function sendDueReminders(
  database: Database,
  deps: ReminderJobDeps,
): Promise<ReminderJobResult> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const leadHours = deps.leadHours ?? DEFAULT_LEAD_HOURS;
  const windowMinutes = deps.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const leadMs = leadHours * 60 * 60 * 1000;
  const windowMs = windowMinutes * 60 * 1000;
  const now = new Date(nowMs);

  const due = await findBookingsDueForReminder(database, { now, leadMs, windowMs });

  const result: ReminderJobResult = {
    considered: due.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const booking of due) {
    const claimed = await tryClaim(database, booking, now, result);
    if (!claimed) continue;
    await dispatch(booking, deps, result);
  }

  return result;
}

async function tryClaim(
  database: Database,
  booking: BookingDueForReminder,
  now: Date,
  result: ReminderJobResult,
): Promise<boolean> {
  try {
    const claimed = await markReminderSent(database, booking.bookingId, now);
    if (!claimed) {
      result.skipped += 1;
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[reminder-job] claim failed for booking=${booking.bookingId}:`, err);
    result.failed += 1;
    return false;
  }
}

async function dispatch(
  booking: BookingDueForReminder,
  deps: ReminderJobDeps,
  result: ReminderJobResult,
): Promise<void> {
  // ISH-149: link/owner fields are projected by the JOIN in
  // findBookingsDueForReminder, so no per-booking SELECT is needed here.
  const ctx: BookingNotificationContext = {
    linkTitle: booking.linkTitle,
    linkDescription: booking.linkDescription,
    startAt: booking.startAt,
    endAt: booking.endAt,
    ownerEmail: booking.ownerEmail,
    ownerName: booking.ownerName,
    guestEmail: booking.guestEmail,
    guestName: booking.guestName,
    guestTimeZone: booking.guestTimeZone,
    ownerTimeZone: booking.linkTimeZone,
    meetUrl: booking.meetUrl,
    cancelUrl: `${deps.appBaseUrl}/cancel/${booking.cancellationToken}`,
  };
  try {
    await Promise.all([
      deps.sendEmail(ownerReminderEmail(ctx)),
      deps.sendEmail(guestReminderEmail(ctx)),
    ]);
    result.sent += 1;
  } catch (err) {
    console.error(`[reminder-job] dispatch failed for booking=${booking.bookingId}:`, err);
    result.failed += 1;
    // Do NOT clear reminder_sent_at — single-send semantics dominate.
  }
}
