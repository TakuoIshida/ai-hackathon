-- ISH-252: persist `role` on tenant.invitations.
-- Previously POST /tenant/invitations accepted role in the request body but
-- the column did not exist, so acceptInvitation always assigned 'member'.
-- This migration adds the column with a safe default + CHECK constraint that
-- mirrors common.tenant_members.role.

ALTER TABLE "tenant"."invitations"
	ADD COLUMN "role" text DEFAULT 'member' NOT NULL;
--> statement-breakpoint

ALTER TABLE "tenant"."invitations"
	ADD CONSTRAINT "invitations_role_check" CHECK ("tenant"."invitations"."role" IN ('owner', 'member'));
