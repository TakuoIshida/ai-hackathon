-- ISH-168: common schema creation + users / tenants / tenant_members
-- Replaces public.users (clerk_id → external_id),
-- public.workspaces → common.tenants (slug / owner_user_id removed),
-- public.memberships → common.tenant_members (UNIQUE(user_id) for 1 user = 1 tenant).
-- The invitations table stays in public for now (moved in D-2 / ISH-169).

-- 1. Create the common schema
CREATE SCHEMA "common";
--> statement-breakpoint

-- 2. common.users (replaces public.users; clerk_id → external_id)
CREATE TABLE "common"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"time_zone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint

-- 3. common.tenants (replaces public.workspaces; slug / owner_user_id removed)
CREATE TABLE "common"."tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 4. common.tenant_members (replaces public.memberships; UNIQUE(user_id) for 1 user = 1 tenant)
CREATE TABLE "common"."tenant_members" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "tenant_members_role_check" CHECK ("tenant_members"."role" IN ('owner', 'member'))
);
--> statement-breakpoint

-- 5. FKs for common.tenant_members
ALTER TABLE "common"."tenant_members"
	ADD CONSTRAINT "tenant_members_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "common"."tenant_members"
	ADD CONSTRAINT "tenant_members_tenant_id_common_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- 6. Index on tenant_members(tenant_id) for lookups
CREATE INDEX "idx_tenant_members_tenant" ON "common"."tenant_members" ("tenant_id");
--> statement-breakpoint

-- 7. Drop old public.memberships (replaced by common.tenant_members)
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT IF EXISTS "memberships_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workspaces" DROP CONSTRAINT IF EXISTS "workspaces_owner_user_id_users_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "memberships";
--> statement-breakpoint

-- 8. Drop old public.workspaces (replaced by common.tenants)
DROP TABLE IF EXISTS "workspaces";
--> statement-breakpoint

-- 9. Drop old public.users and its dependents, then recreate as re-export.
-- availability_links, google_oauth_accounts, link_owners, invitations reference public.users.
-- Re-point them to common.users after dropping old FK.
ALTER TABLE "availability_links" DROP CONSTRAINT IF EXISTS "availability_links_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "google_oauth_accounts" DROP CONSTRAINT IF EXISTS "google_oauth_accounts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "link_owners" DROP CONSTRAINT IF EXISTS "link_owners_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT IF EXISTS "invitations_invited_by_user_id_users_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "users";
--> statement-breakpoint

-- 10. Re-add FKs pointing to common.users and common.tenants
ALTER TABLE "availability_links"
	ADD CONSTRAINT "availability_links_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_oauth_accounts"
	ADD CONSTRAINT "google_oauth_accounts_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "link_owners"
	ADD CONSTRAINT "link_owners_user_id_common_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations"
	ADD CONSTRAINT "invitations_invited_by_user_id_common_users_id_fk"
	FOREIGN KEY ("invited_by_user_id") REFERENCES "common"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invitations"
	ADD CONSTRAINT "invitations_workspace_id_common_tenants_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "common"."tenants"("id") ON DELETE cascade ON UPDATE no action;
