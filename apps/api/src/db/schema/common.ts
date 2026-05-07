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

/**
 * Allowed values for `tenant_members.role` (ISH-199).
 *
 * SINGLE source of truth — the SQL CHECK constraint and the TS union type
 * below are both derived from this const, so adding a new role (e.g. 'admin')
 * automatically propagates to both. `as const` is required so the union type
 * is the literal strings, not `string`.
 */
export const TENANT_MEMBER_ROLES = ["owner", "member"] as const;
export type TenantMemberRole = (typeof TENANT_MEMBER_ROLES)[number];

/**
 * Name of the UNIQUE constraint on `common.tenant_members.user_id` that
 * enforces "1 user = 1 tenant". Drizzle auto-derives this from the column's
 * `.unique()` modifier (`<table>_<column>_unique`); we re-export it as a
 * named constant so error-handling code (e.g. ISH-274's `acceptInvitation`
 * race recovery) can match `unique_violation` errors by constraint name
 * without re-typing the magic string.
 */
export const TENANT_MEMBERS_USER_ID_UNIQUE = "tenant_members_user_id_unique";

// SQL fragment for the CHECK constraint: `'owner', 'member'` (raw because we
// want literal SQL, not parameter placeholders).
const TENANT_MEMBER_ROLES_SQL = sql.raw(TENANT_MEMBER_ROLES.map((r) => `'${r}'`).join(", "));

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
    // CHECK constraint: role must be one of TENANT_MEMBER_ROLES.
    check("tenant_members_role_check", sql`${t.role} IN (${TENANT_MEMBER_ROLES_SQL})`),
  ],
);

export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
