import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const googleOauthAccounts = pgTable(
  "google_oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleUserId: text("google_user_id").notNull(),
    email: text("email").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenAuthTag: text("refresh_token_auth_tag").notNull(),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_user_google").on(t.userId, t.googleUserId)],
);

export const googleCalendars = pgTable(
  "google_calendars",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    oauthAccountId: uuid("oauth_account_id")
      .notNull()
      .references(() => googleOauthAccounts.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary"),
    timeZone: text("time_zone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    usedForBusy: boolean("used_for_busy").notNull().default(true),
    usedForWrites: boolean("used_for_writes").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_account_calendar").on(t.oauthAccountId, t.googleCalendarId)],
);

export type GoogleOauthAccount = typeof googleOauthAccounts.$inferSelect;
export type NewGoogleOauthAccount = typeof googleOauthAccounts.$inferInsert;
export type GoogleCalendar = typeof googleCalendars.$inferSelect;
export type NewGoogleCalendar = typeof googleCalendars.$inferInsert;
