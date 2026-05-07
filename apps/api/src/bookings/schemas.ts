import { z } from "zod";
import type { ConfirmBookingCommand } from "./domain";
import type { RescheduleBookingCommand } from "./reschedule";

export const bookingInputSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  guestName: z.string().min(1).max(200),
  guestEmail: z.string().email().max(320),
  guestNote: z.string().max(2000).nullable().optional(),
  guestTimeZone: z.string().min(1).max(64).nullable().optional(),
});

// ISH-270: POST /bookings/:id/reschedule body. Carries the new (start, end)
// pair; the route boundary parses both ISO-8601 strings into ms before handing
// off to the usecase via `toRescheduleBookingCommand`.
export const rescheduleInputSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
});

type RescheduleInput = z.infer<typeof rescheduleInputSchema>;

export function toRescheduleBookingCommand(
  input: RescheduleInput,
): RescheduleBookingCommand | null {
  const startMs = Date.parse(input.startAt);
  const endMs = Date.parse(input.endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

// Wire-format type stays internal — `confirm.ts` consumes
// `ConfirmBookingCommand` from `./domain` instead.
type BookingInput = z.infer<typeof bookingInputSchema>;

/**
 * Convert the parsed wire format from `bookingInputSchema` to a domain command.
 * Returns `null` if `startAt` cannot be parsed to a finite epoch — callers map
 * that to a 400 (`invalid_start_at`) at the route boundary (ISH-124).
 */
export function toConfirmBookingCommand(input: BookingInput): ConfirmBookingCommand | null {
  const startMs = Date.parse(input.startAt);
  if (!Number.isFinite(startMs)) return null;
  return {
    startMs,
    guestName: input.guestName,
    guestEmail: input.guestEmail,
    guestNote: input.guestNote ?? null,
    guestTimeZone: input.guestTimeZone ?? null,
  };
}
