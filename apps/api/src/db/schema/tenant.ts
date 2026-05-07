import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenantId, ulidPk } from "../helpers/ulid";
import { TENANT_MEMBER_ROLES, tenants, users } from "./common";

// SQL fragment for the role CHECK constraint (matches common.tenant_members).
// Single source of truth: TENANT_MEMBER_ROLES in common.ts.
const TENANT_MEMBER_ROLES_SQL = sql.raw(TENANT_MEMBER_ROLES.map((r) => `'${r}'`).join(", "));

/**
 * Tenant schema: business data tables isolated per tenant.
 * RLS will be applied in D-3 (ISH-170). All tables carry tenant_id NOT NULL
 * with an index as required by docs/design/rls.md §4.
 *
 * D-2 (ISH-169): move 8 tables from public → tenant schema.
 */
export const tenantSchema = pgSchema("tenant");

// ---------------------------------------------------------------------------
// tenant.invitations
// Moved from public.invitations (ISH-169). workspace_id renamed to tenant_id.
// ---------------------------------------------------------------------------
export const invitations = tenantSchema.table(
  "invitations",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Security token: keep UUIDv4 to avoid timestamp exposure (P-5 design doc)
    token: uuid("token").notNull().unique().defaultRandom(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * Role to assign on acceptance (ISH-252). Values mirror
     * common.tenant_members.role — see TENANT_MEMBER_ROLES in common.ts.
     * Default 'member' so the column is safe to backfill on existing rows.
     */
    role: text("role").notNull().default("member"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("invitations_tenant_id_idx").on(t.tenantId),
    // Partial unique index: only one OPEN invitation per (tenant, email).
    // Once acceptedAt is set, the row is kept for audit but the constraint
    // releases so the same email can be re-invited later.
    uniqueIndex("uniq_tenant_email_open").on(t.tenantId, t.email).where(sql`accepted_at IS NULL`),
    // Role must match the values allowed by common.tenant_members.role.
    check("invitations_role_check", sql`${t.role} IN (${TENANT_MEMBER_ROLES_SQL})`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.availability_links
// Moved from public.availability_links (ISH-169).
// ---------------------------------------------------------------------------
export const availabilityLinks = tenantSchema.table(
  "availability_links",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
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
    index("availability_links_tenant_id_idx").on(t.tenantId),
    index("idx_availability_links_user").on(t.userId),
    check("slug_format", sql`${t.slug} ~ '^[a-z0-9-]{1,64}$'`),
    check("duration_positive", sql`${t.durationMinutes} > 0`),
  ],
);

export type AvailabilityLink = typeof availabilityLinks.$inferSelect;
export type NewAvailabilityLink = typeof availabilityLinks.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.availability_rules
// Moved from public.availability_rules (ISH-169).
// ---------------------------------------------------------------------------
export const availabilityRules = tenantSchema.table(
  "availability_rules",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    linkId: text("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
  },
  (t) => [
    index("availability_rules_tenant_id_idx").on(t.tenantId),
    index("idx_availability_rules_link").on(t.linkId),
    check("weekday_range", sql`${t.weekday} BETWEEN 0 AND 6`),
    check(
      "rule_minute_range",
      sql`${t.startMinute} >= 0 AND ${t.endMinute} <= 1440 AND ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);

export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type NewAvailabilityRule = typeof availabilityRules.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.availability_excludes
// Moved from public.availability_excludes (ISH-169).
// ---------------------------------------------------------------------------
export const availabilityExcludes = tenantSchema.table(
  "availability_excludes",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    linkId: text("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "cascade" }),
    localDate: varchar("local_date", { length: 10 }).notNull(),
  },
  (t) => [
    index("availability_excludes_tenant_id_idx").on(t.tenantId),
    uniqueIndex("uniq_link_date").on(t.linkId, t.localDate),
    check("local_date_format", sql`${t.localDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
);

export type AvailabilityExclude = typeof availabilityExcludes.$inferSelect;
export type NewAvailabilityExclude = typeof availabilityExcludes.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.bookings
// Moved from public.bookings (ISH-169).
// ---------------------------------------------------------------------------
export const bookingStatusValues = ["confirmed", "canceled"] as const;
export type BookingStatus = (typeof bookingStatusValues)[number];

export const bookings = tenantSchema.table(
  "bookings",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    linkId: text("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "restrict" }),
    // ISH-267: denormalized host (owner) reference so the dashboard list /
    // detail endpoints can return the host name + email without a transitive
    // JOIN through availability_links every time. Populated at insert with
    // link.user_id; survives any future link reassignment.
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    guestName: text("guest_name").notNull(),
    guestEmail: text("guest_email").notNull(),
    guestNote: text("guest_note"),
    guestTimeZone: text("guest_time_zone"),
    status: varchar("status", { length: 16 }).notNull().default("confirmed"),
    googleEventId: text("google_event_id"),
    googleHtmlLink: text("google_html_link"),
    meetUrl: text("meet_url"),
    // Security token: keep UUIDv4 to avoid timestamp exposure (P-5 design doc)
    cancellationToken: uuid("cancellation_token").defaultRandom().notNull().unique(),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (t) => [
    index("bookings_tenant_id_idx").on(t.tenantId),
    index("idx_bookings_link_start").on(t.linkId, t.startAt),
    index("idx_bookings_status_start").on(t.status, t.startAt),
    index("idx_bookings_host_user_id").on(t.hostUserId),
    // Dual-booking guard: at most one confirmed booking per (link, slot start).
    // Canceled rows do not block re-booking the same slot.
    uniqueIndex("uniq_bookings_active_slot")
      .on(t.linkId, t.startAt)
      .where(sql`${t.status} = 'confirmed'`),
    check("status_values", sql`${t.status} IN ('confirmed', 'canceled')`),
    check("end_after_start", sql`${t.endAt} > ${t.startAt}`),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.link_owners
// Moved from public.link_owners (ISH-169).
// ISH-112: co-owners on a link. The link's `userId` (the creator) is the
// "primary owner" and is implicit — it does NOT appear in this table.
// ---------------------------------------------------------------------------
export const linkOwners = tenantSchema.table(
  "link_owners",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    linkId: text("link_id")
      .notNull()
      .references(() => availabilityLinks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("link_owners_tenant_id_idx").on(t.tenantId),
    uniqueIndex("uniq_link_owner").on(t.linkId, t.userId),
    index("idx_link_owners_user").on(t.userId),
  ],
);

export type LinkOwner = typeof linkOwners.$inferSelect;
export type NewLinkOwner = typeof linkOwners.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.google_oauth_accounts
// Moved from public.google_oauth_accounts (ISH-169).
// ---------------------------------------------------------------------------
export const googleOauthAccounts = tenantSchema.table(
  "google_oauth_accounts",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id")
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
  (t) => [
    index("google_oauth_accounts_tenant_id_idx").on(t.tenantId),
    uniqueIndex("uniq_user_google").on(t.userId, t.googleUserId),
  ],
);

export type GoogleOauthAccount = typeof googleOauthAccounts.$inferSelect;
export type NewGoogleOauthAccount = typeof googleOauthAccounts.$inferInsert;

// ---------------------------------------------------------------------------
// tenant.google_calendars
// Moved from public.google_calendars (ISH-169).
// ---------------------------------------------------------------------------
export const googleCalendars = tenantSchema.table(
  "google_calendars",
  {
    id: ulidPk(),
    tenantId: tenantId().references(() => tenants.id, { onDelete: "cascade" }),
    oauthAccountId: text("oauth_account_id")
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
  (t) => [
    index("google_calendars_tenant_id_idx").on(t.tenantId),
    uniqueIndex("uniq_account_calendar").on(t.oauthAccountId, t.googleCalendarId),
  ],
);

export type GoogleCalendar = typeof googleCalendars.$inferSelect;
export type NewGoogleCalendar = typeof googleCalendars.$inferInsert;
