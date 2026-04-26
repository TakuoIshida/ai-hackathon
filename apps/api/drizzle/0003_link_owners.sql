CREATE TABLE "link_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "link_owners" ADD CONSTRAINT "link_owners_link_id_availability_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."availability_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_owners" ADD CONSTRAINT "link_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_link_owner" ON "link_owners" USING btree ("link_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_link_owners_user" ON "link_owners" USING btree ("user_id");