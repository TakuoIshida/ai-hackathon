-- ISH-169: create tenant schema and move 8 business-data tables out of public.
-- Each table gains tenant_id text NOT NULL with a FK to common.tenants(id).
-- invitations.workspace_id is renamed to tenant_id (table recreated fresh).
-- Old public.* tables are dropped after the new tenant.* tables exist.

-- 1. Create the tenant schema
CREATE SCHEMA "tenant";
--> statement-breakpoint

-- 2. tenant.invitations (moved from public.invitations; workspace_id → tenant_id)
CREATE TABLE "tenant"."invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "tenant"."invitations"
	ADD CONSTRAINT "invitations_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."invitations"
	ADD CONSTRAINT "invitations_invited_by_user_id_common_users_id_fk"
	FOREIGN KEY ("invited_by_user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "invitations_tenant_id_idx" ON "tenant"."invitations" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_tenant_email_open" ON "tenant"."invitations" ("tenant_id", "email") WHERE accepted_at IS NULL;
--> statement-breakpoint

-- 3. tenant.availability_links (moved from public.availability_links)
CREATE TABLE "tenant"."availability_links" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slug" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"slot_interval_minutes" integer,
	"max_per_day" integer,
	"lead_time_hours" integer DEFAULT 0 NOT NULL,
	"range_days" integer DEFAULT 60 NOT NULL,
	"time_zone" text NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_links_slug_unique" UNIQUE("slug"),
	CONSTRAINT "slug_format" CHECK ("tenant"."availability_links"."slug" ~ '^[a-z0-9-]{1,64}$'),
	CONSTRAINT "duration_positive" CHECK ("tenant"."availability_links"."duration_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "tenant"."availability_links"
	ADD CONSTRAINT "availability_links_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."availability_links"
	ADD CONSTRAINT "availability_links_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "availability_links_tenant_id_idx" ON "tenant"."availability_links" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "idx_availability_links_user" ON "tenant"."availability_links" ("user_id");
--> statement-breakpoint

-- 4. tenant.availability_rules (moved from public.availability_rules)
CREATE TABLE "tenant"."availability_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"link_id" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "weekday_range" CHECK ("tenant"."availability_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "rule_minute_range" CHECK ("tenant"."availability_rules"."start_minute" >= 0 AND "tenant"."availability_rules"."end_minute" <= 1440 AND "tenant"."availability_rules"."start_minute" < "tenant"."availability_rules"."end_minute")
);
--> statement-breakpoint
ALTER TABLE "tenant"."availability_rules"
	ADD CONSTRAINT "availability_rules_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."availability_rules"
	ADD CONSTRAINT "availability_rules_link_id_tenant_availability_links_id_fk"
	FOREIGN KEY ("link_id") REFERENCES "tenant"."availability_links"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "availability_rules_tenant_id_idx" ON "tenant"."availability_rules" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "idx_availability_rules_link" ON "tenant"."availability_rules" ("link_id");
--> statement-breakpoint

-- 5. tenant.availability_excludes (moved from public.availability_excludes)
CREATE TABLE "tenant"."availability_excludes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"link_id" text NOT NULL,
	"local_date" varchar(10) NOT NULL,
	CONSTRAINT "local_date_format" CHECK ("tenant"."availability_excludes"."local_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
ALTER TABLE "tenant"."availability_excludes"
	ADD CONSTRAINT "availability_excludes_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."availability_excludes"
	ADD CONSTRAINT "availability_excludes_link_id_tenant_availability_links_id_fk"
	FOREIGN KEY ("link_id") REFERENCES "tenant"."availability_links"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "availability_excludes_tenant_id_idx" ON "tenant"."availability_excludes" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_link_date" ON "tenant"."availability_excludes" ("link_id", "local_date");
--> statement-breakpoint

-- 6. tenant.bookings (moved from public.bookings)
CREATE TABLE "tenant"."bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"link_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"guest_note" text,
	"guest_time_zone" text,
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"google_event_id" text,
	"meet_url" text,
	"cancellation_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "bookings_cancellation_token_unique" UNIQUE("cancellation_token"),
	CONSTRAINT "status_values" CHECK ("tenant"."bookings"."status" IN ('confirmed', 'canceled')),
	CONSTRAINT "end_after_start" CHECK ("tenant"."bookings"."end_at" > "tenant"."bookings"."start_at")
);
--> statement-breakpoint
ALTER TABLE "tenant"."bookings"
	ADD CONSTRAINT "bookings_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."bookings"
	ADD CONSTRAINT "bookings_link_id_tenant_availability_links_id_fk"
	FOREIGN KEY ("link_id") REFERENCES "tenant"."availability_links"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bookings_tenant_id_idx" ON "tenant"."bookings" ("tenant_id");
--> statement-breakpoint
CREATE INDEX "idx_bookings_link_start" ON "tenant"."bookings" ("link_id", "start_at");
--> statement-breakpoint
CREATE INDEX "idx_bookings_status_start" ON "tenant"."bookings" ("status", "start_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_bookings_active_slot" ON "tenant"."bookings" ("link_id", "start_at") WHERE "tenant"."bookings"."status" = 'confirmed';
--> statement-breakpoint

-- 7. tenant.link_owners (moved from public.link_owners)
CREATE TABLE "tenant"."link_owners" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"link_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant"."link_owners"
	ADD CONSTRAINT "link_owners_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."link_owners"
	ADD CONSTRAINT "link_owners_link_id_tenant_availability_links_id_fk"
	FOREIGN KEY ("link_id") REFERENCES "tenant"."availability_links"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."link_owners"
	ADD CONSTRAINT "link_owners_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "link_owners_tenant_id_idx" ON "tenant"."link_owners" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_link_owner" ON "tenant"."link_owners" ("link_id", "user_id");
--> statement-breakpoint
CREATE INDEX "idx_link_owners_user" ON "tenant"."link_owners" ("user_id");
--> statement-breakpoint

-- 8. tenant.google_oauth_accounts (moved from public.google_oauth_accounts)
CREATE TABLE "tenant"."google_oauth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"google_user_id" text NOT NULL,
	"email" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_auth_tag" text NOT NULL,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant"."google_oauth_accounts"
	ADD CONSTRAINT "google_oauth_accounts_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."google_oauth_accounts"
	ADD CONSTRAINT "google_oauth_accounts_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "google_oauth_accounts_tenant_id_idx" ON "tenant"."google_oauth_accounts" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_user_google" ON "tenant"."google_oauth_accounts" ("user_id", "google_user_id");
--> statement-breakpoint

-- 9. tenant.google_calendars (moved from public.google_calendars)
CREATE TABLE "tenant"."google_calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"oauth_account_id" text NOT NULL,
	"google_calendar_id" text NOT NULL,
	"summary" text,
	"time_zone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"used_for_busy" boolean DEFAULT true NOT NULL,
	"used_for_writes" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant"."google_calendars"
	ADD CONSTRAINT "google_calendars_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant"."google_calendars"
	ADD CONSTRAINT "google_calendars_oauth_account_id_tenant_google_oauth_accounts_id_fk"
	FOREIGN KEY ("oauth_account_id") REFERENCES "tenant"."google_oauth_accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "google_calendars_tenant_id_idx" ON "tenant"."google_calendars" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_account_calendar" ON "tenant"."google_calendars" ("oauth_account_id", "google_calendar_id");
--> statement-breakpoint

-- 10. Drop old public.* tables (constraints first, then tables).
-- Order: tables that are FK targets must be dropped last.
-- google_calendars → google_oauth_accounts
-- bookings, availability_rules, availability_excludes, link_owners → availability_links
-- invitations (standalone, just drop)

-- Drop dependent-table constraints first
ALTER TABLE "google_calendars" DROP CONSTRAINT IF EXISTS "google_calendars_oauth_account_id_google_oauth_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_link_id_availability_links_id_fk";
--> statement-breakpoint
ALTER TABLE "availability_rules" DROP CONSTRAINT IF EXISTS "availability_rules_link_id_availability_links_id_fk";
--> statement-breakpoint
ALTER TABLE "availability_excludes" DROP CONSTRAINT IF EXISTS "availability_excludes_link_id_availability_links_id_fk";
--> statement-breakpoint
ALTER TABLE "link_owners" DROP CONSTRAINT IF EXISTS "link_owners_link_id_availability_links_id_fk";
--> statement-breakpoint
ALTER TABLE "link_owners" DROP CONSTRAINT IF EXISTS "link_owners_user_id_common_users_id_fk";
--> statement-breakpoint
ALTER TABLE "google_oauth_accounts" DROP CONSTRAINT IF EXISTS "google_oauth_accounts_user_id_common_users_id_fk";
--> statement-breakpoint
ALTER TABLE "availability_links" DROP CONSTRAINT IF EXISTS "availability_links_user_id_common_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_workspace_id_common_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_invited_by_user_id_common_users_id_fk";
--> statement-breakpoint

-- Drop the old public tables
DROP TABLE IF EXISTS "google_calendars";
--> statement-breakpoint
DROP TABLE IF EXISTS "bookings";
--> statement-breakpoint
DROP TABLE IF EXISTS "link_owners";
--> statement-breakpoint
DROP TABLE IF EXISTS "availability_rules";
--> statement-breakpoint
DROP TABLE IF EXISTS "availability_excludes";
--> statement-breakpoint
DROP TABLE IF EXISTS "google_oauth_accounts";
--> statement-breakpoint
DROP TABLE IF EXISTS "availability_links";
--> statement-breakpoint
DROP TABLE IF EXISTS "invitations";
