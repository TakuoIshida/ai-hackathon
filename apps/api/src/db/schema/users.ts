import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ulidPk } from "../helpers/ulid";

export const users = pgTable("users", {
  id: ulidPk(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
