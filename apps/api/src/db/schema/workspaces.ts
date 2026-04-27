import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ulidPk } from "../helpers/ulid";
import { users } from "./users";

export const workspaces = pgTable("workspaces", {
  id: ulidPk(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export const memberships = pgTable(
  "memberships",
  {
    id: ulidPk(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] })
      .notNull()
      .default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_workspace_user").on(t.workspaceId, t.userId)],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type MembershipRole = Membership["role"];

// ISH-108: workspace member invitations.
//
// `acceptedAt` flips from null to non-null when the invitee follows the link
// and a membership row is created (ISH-109). Once accepted, the invitation
// is kept for audit but is no longer redeemable.
export const invitations = pgTable(
  "invitations",
  {
    id: ulidPk(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Security token: keep UUIDv4 to avoid timestamp exposure (P-5 design doc)
    token: uuid("token").notNull().unique().defaultRandom(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Partial unique index: only one OPEN invitation per (workspace, email).
    // Once acceptedAt is set, the row is kept for audit but the constraint
    // releases so the same email can be re-invited later.
    uniqueIndex("uniq_workspace_email_open")
      .on(t.workspaceId, t.email)
      .where(sql`accepted_at IS NULL`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
