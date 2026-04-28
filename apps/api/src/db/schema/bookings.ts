// NOTE: bookings table has been moved to tenant.bookings (ISH-169 / D-2).
// This file re-exports from tenant.ts for backward compatibility during migration.
// Direct imports from "@/db/schema/bookings" still work, but prefer "@/db/schema/tenant".
export {
  type Booking,
  type BookingStatus,
  bookingStatusValues,
  bookings,
  type NewBooking,
} from "./tenant";
