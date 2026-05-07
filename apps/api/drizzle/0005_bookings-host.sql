-- ISH-267: persist host (owner) on tenant.bookings.
-- Previously the FE BookingSummary shape had no host info, so the UI hard-coded
-- "あなた" / "このワークスペースのオーナー" placeholders. Adding a denormalized
-- host_user_id column lets GET /bookings + /bookings/:id JOIN common.users to
-- return the owner's name + email per row.
--
-- Why denormalize instead of always JOINing through availability_links → users?
-- Two reasons:
--   1. Future ticket may allow assigning a different host than the link primary
--      owner (e.g. round-robin), at which point the link.user_id ↔ booking host
--      identity breaks down. Owning a column on bookings keeps that future
--      change a no-op for the read path.
--   2. The list endpoint already JOINs availability_links for slug/title; a
--      second JOIN is fine but the explicit column makes the read intent clear
--      ("this is the host of THIS booking") and survives link reassignment.
--
-- Backfill strategy: every existing booking inherits the link's user_id as the
-- host. We populate the column first via UPDATE while it's still nullable, then
-- flip to NOT NULL. New inserts (bookings/usecase.ts) explicitly pass
-- hostUserId = link.userId.

ALTER TABLE "tenant"."bookings"
	ADD COLUMN "host_user_id" text;
--> statement-breakpoint

UPDATE "tenant"."bookings" b
	SET "host_user_id" = al."user_id"
	FROM "tenant"."availability_links" al
	WHERE b."link_id" = al."id";
--> statement-breakpoint

ALTER TABLE "tenant"."bookings"
	ALTER COLUMN "host_user_id" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "tenant"."bookings"
	ADD CONSTRAINT "bookings_host_user_id_common_users_id_fk"
	FOREIGN KEY ("host_user_id") REFERENCES "common"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_bookings_host_user_id" ON "tenant"."bookings" ("host_user_id");
