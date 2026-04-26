import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const availabilityLinks = pgTable(
  "availability_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    slotIntervalMinutes: integer("slot_interval_minutes"),
    maxPerDay: integer("max_per_day"),
    leadTimeHours: integer("lead_time_hours").notNull().default(0),
    rangeDays: integer("range_days").notNull().default(60),
    timeZone: text("time_zone").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_availability_links_user").on(t.userId),
    check("slug_format", sql`${t.slug} ~ '^[a-z0-9-]{1,64}$'`),
    check("duration_positive", sql`${t.durationMinutes} > 0`),
  ],
);

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
  },
  (t) => [
    index("idx_availability_rules_link").on(t.linkId),
    check("weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
    check(
      "rule_minute_range",
      sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);

export const availabilityExcludes = pgTable(
  "availability_excludes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "cascade" }),
    localDate: varchar("local_date", { length: 10 }).notNull(),
  },
  (t) => [
    uniqueIndex("uniq_link_date").on(t.linkId, t.localDate),
    check("local_date_format", sql`${t.localDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
);

export type AvailabilityLink = typeof availabilityLinks.$inferSelect;
export type NewAvailabilityLink = typeof availabilityLinks.$inferInsert;
export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type NewAvailabilityRule = typeof availabilityRules.$inferInsert;
export type AvailabilityExclude = typeof availabilityExcludes.$inferSelect;
export type NewAvailabilityExclude = typeof availabilityExcludes.$inferInsert;
