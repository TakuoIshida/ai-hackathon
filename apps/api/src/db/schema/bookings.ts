import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { availabilityLinks } from "./links";

export const bookingStatusValues = ["confirmed", "canceled"] as const;
export type BookingStatus = (typeof bookingStatusValues)[number];

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "restrict" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    guestNote: text("guest_note"),
    guestTimeZone: text("guest_time_zone"),
    status: varchar("status", { length: 16 }).notNull().default("confirmed"),
    googleEventId: text("google_event_id"),
    meetUrl: text("meet_url"),
    cancellationToken: uuid("cancellation_token").defaultRandom().notNull().unique(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_bookings_link_start").on(t.linkId, t.startAt),
    index("idx_bookings_status_start").on(t.status, t.startAt),
    check("status_values", sql`${t.status} IN ('confirmed', 'canceled')`),
    check("end_after_start", sql`${t.endAt} > ${t.startAt}`),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
