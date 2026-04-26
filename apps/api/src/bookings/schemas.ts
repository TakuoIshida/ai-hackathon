import { z } from "zod";

export const bookingInputSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  guestName: z.string().min(1).max(200),
  guestEmail: z.string().email().max(320),
  guestNote: z.string().max(2000).nullable().optional(),
  guestTimeZone: z.string().min(1).max(64).nullable().optional(),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;
