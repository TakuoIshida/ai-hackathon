import { sql } from "drizzle-orm";
import { check, index, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { ulidPk } from "../helpers/ulid";

/**
 * Common schema: authentication + multi-tenant management tables.
 * RLS is NOT applied to this schema (see docs/design/rls.md §6).
 *
 * D-1 (ISH-168): common.users / common.tenants / common.tenant_members
 */
export const commonSchema = pgSchema("common");

// ---------------------------------------------------------------------------
// common.users
// Replaces public.users. clerk_id renamed to external_id.
// ---------------------------------------------------------------------------
export const users = commonSchema.table("users", {
  id: ulidPk(),
  /** External IdP identifier (formerly clerk_id). */
  externalId: text("external_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// common.tenants
// Replaces public.workspaces. slug / owner_user_id columns removed.
// ---------------------------------------------------------------------------
export const tenants = commonSchema.table("tenants", {
  id: ulidPk(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

// ---------------------------------------------------------------------------
// common.tenant_members
// Replaces public.memberships.
// UNIQUE(user_id) enforces 1 user = 1 tenant at the DB level.
// role is text + CHECK (Option B per design doc §3).
// ---------------------------------------------------------------------------
export const tenantMembers = commonSchema.table(
  "tenant_members",
  {
    id: ulidPk(),
    /** FK → common.users(id). UNIQUE enforces 1 user = 1 tenant. */
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    /** FK → common.tenants(id). */
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Search index for tenant_id lookups (not RLS, but needed for queries).
    index("idx_tenant_members_tenant").on(t.tenantId),
    // CHECK constraint: role must be 'owner' or 'member' (Option B).
    check("tenant_members_role_check", sql`${t.role} IN ('owner', 'member')`),
  ],
);

export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
export type TenantMemberRole = "owner" | "member";
