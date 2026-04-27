import type { BookingNotifier } from "@/notifications/types";

/**
 * Cross-feature notification port. Aliased from `BookingNotifier` so feature
 * usecases (bookings) can depend on `@/ports` without reaching into
 * `@/notifications/types` directly. The notifications feature still owns the
 * underlying type and adapter (`createBookingNotifier`).
 */
export type NotificationPort = BookingNotifier;
