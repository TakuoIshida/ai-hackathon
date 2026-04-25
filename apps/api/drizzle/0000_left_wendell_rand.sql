CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
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
	CONSTRAINT "status_values" CHECK ("bookings"."status" IN ('confirmed', 'canceled')),
	CONSTRAINT "end_after_start" CHECK ("bookings"."end_at" > "bookings"."start_at")
);
--> statement-breakpoint
CREATE TABLE "google_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oauth_account_id" uuid NOT NULL,
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
CREATE TABLE "google_oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"time_zone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "availability_excludes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"local_date" varchar(10) NOT NULL,
	CONSTRAINT "local_date_format" CHECK ("availability_excludes"."local_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "availability_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
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
	CONSTRAINT "slug_format" CHECK ("availability_links"."slug" ~ '^[a-z0-9-]{1,64}$'),
	CONSTRAINT "duration_positive" CHECK ("availability_links"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	CONSTRAINT "weekday_range" CHECK ("availability_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "rule_minute_range" CHECK ("availability_rules"."start_minute" >= 0 AND "availability_rules"."end_minute" <= 1440 AND "availability_rules"."start_minute" < "availability_rules"."end_minute")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_link_id_availability_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."availability_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendars" ADD CONSTRAINT "google_calendars_oauth_account_id_google_oauth_accounts_id_fk" FOREIGN KEY ("oauth_account_id") REFERENCES "public"."google_oauth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_oauth_accounts" ADD CONSTRAINT "google_oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_excludes" ADD CONSTRAINT "availability_excludes_link_id_availability_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."availability_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_links" ADD CONSTRAINT "availability_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_link_id_availability_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."availability_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bookings_link_start" ON "bookings" USING btree ("link_id","start_at");--> statement-breakpoint
CREATE INDEX "idx_bookings_status_start" ON "bookings" USING btree ("status","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_account_calendar" ON "google_calendars" USING btree ("oauth_account_id","google_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_user_google" ON "google_oauth_accounts" USING btree ("user_id","google_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_link_date" ON "availability_excludes" USING btree ("link_id","local_date");--> statement-breakpoint
CREATE INDEX "idx_availability_links_user" ON "availability_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_availability_rules_link" ON "availability_rules" USING btree ("link_id");