/**
 * ISH-170: RLS PoC smoke tests.
 *
 * Verifies that:
 *  1. 0003_rls.sql migration applied cleanly (roles + policies exist).
 *  2. app role with SET LOCAL app.tenant_id cannot see records from another tenant.
 *  3. common.tenants is NOT subject to RLS (app role can SELECT all tenants).
 *
 * Full RLS integration tests (every table, every CRUD op) are Q-1 (ISH-181).
 * This file is intentionally limited to the smoke-test scope of D-3.
 *
 * NOTE: This test connects as the superuser (TEST_DATABASE_URL) which can
 * switch roles via SET ROLE. The app role itself is exercised by executing
 * queries inside a SET ROLE app + SET LOCAL block.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ulid } from "ulidx";
import { createTestDb, type TestDb } from "@/test/integration-db";

let testDb: TestDb;
let rawSql: postgres.Sql;

const MISSING_URL_HINT = "TEST_DATABASE_URL is required for rls-poc tests";

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error(MISSING_URL_HINT);

  testDb = await createTestDb();

  // A second raw connection used to exercise SET ROLE app + SET LOCAL.
  const noVerify = new URL(url).searchParams.get("sslmode") === "no-verify";
  rawSql = postgres(url, {
    max: 1,
    idle_timeout: 5,
    prepare: false,
    ...(noVerify ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}, 30_000);

afterAll(async () => {
  await testDb.$client.close();
  await rawSql.end({ timeout: 5 });
});

beforeEach(async () => {
  // Clean slate for each test — order matters due to FK constraints.
  await testDb.$client.exec(`
    TRUNCATE TABLE
      tenant.bookings,
      tenant.availability_excludes,
      tenant.availability_rules,
      tenant.link_owners,
      tenant.availability_links,
      tenant.google_calendars,
      tenant.google_oauth_accounts,
      tenant.invitations,
      common.tenant_members,
      common.users,
      common.tenants
    RESTART IDENTITY CASCADE;
  `);
});

// ---------------------------------------------------------------------------
// Helper: seed a tenant + user + availability_link row using the superuser
// connection (bypasses RLS). Returns ids.
// ---------------------------------------------------------------------------
async function seedTenantWithLink(opts: {
  tenantName: string;
  email: string;
}): Promise<{ tenantId: string; userId: string; linkId: string }> {
  const tenantId = ulid();
  const userId = ulid();
  const linkId = ulid();

  await testDb.$client.exec(`
    INSERT INTO common.tenants (id, name) VALUES ('${tenantId}', '${opts.tenantName}');
    INSERT INTO common.users (id, external_id, email) VALUES ('${userId}', 'clerk_${randomUUID()}', '${opts.email}');
    INSERT INTO tenant.availability_links
      (id, tenant_id, user_id, slug, title, duration_minutes, time_zone)
    VALUES
      ('${linkId}', '${tenantId}', '${userId}', 'slug-${randomUUID().slice(0, 8)}', 'Test', 30, 'Asia/Tokyo');
  `);

  return { tenantId, userId, linkId };
}

// ---------------------------------------------------------------------------
// Test 1: Migration sentinel — roles and policies exist
// ---------------------------------------------------------------------------
describe("0003_rls migration", () => {
  test("admin role exists with BYPASSRLS", async () => {
    const rows = await rawSql<Array<{ rolname: string; rolbypassrls: boolean }>>`
      SELECT rolname, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'admin'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolbypassrls).toBe(true);
  });

  test("app role exists without BYPASSRLS", async () => {
    const rows = await rawSql<Array<{ rolname: string; rolbypassrls: boolean }>>`
      SELECT rolname, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'app'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  test("tenant_isolation policy exists on all 8 tenant tables", async () => {
    const tables = [
      "invitations",
      "availability_links",
      "availability_rules",
      "availability_excludes",
      "bookings",
      "link_owners",
      "google_oauth_accounts",
      "google_calendars",
    ];

    const rows = await rawSql<Array<{ tablename: string }>>`
      SELECT tablename
      FROM pg_policies
      WHERE schemaname = 'tenant' AND policyname = 'tenant_isolation'
    `;

    const policyTables = rows.map((r) => r.tablename).sort();
    expect(policyTables).toEqual([...tables].sort());
  });

  test("RLS is enabled on tenant.bookings", async () => {
    const rows = await rawSql<Array<{ rowsecurity: boolean }>>`
      SELECT c.relrowsecurity AS rowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'tenant' AND c.relname = 'bookings'
    `;
    expect(rows[0]?.rowsecurity).toBe(true);
  });

  test("common.tenants does NOT have RLS enabled", async () => {
    const rows = await rawSql<Array<{ rowsecurity: boolean }>>`
      SELECT c.relrowsecurity AS rowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'common' AND c.relname = 'tenants'
    `;
    expect(rows[0]?.rowsecurity).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper: run a query as the app role with a specific tenant_id set via
// SET LOCAL inside a transaction. Returns the SELECT result rows.
// ---------------------------------------------------------------------------
async function queryAsApp(
  query: string,
  tenantId: string | null,
): Promise<Array<Record<string, unknown>>> {
  // postgres-js `unsafe` only handles a single statement at a time reliably
  // for result-set access. Use a transaction callback instead.
  const result = await rawSql.begin(async (tx) => {
    // Switch to app role for this transaction
    await tx.unsafe("SET LOCAL ROLE app");
    if (tenantId !== null) {
      await tx.unsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
    }
    return tx.unsafe(query);
  });
  return result as Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Test 2: Cross-tenant isolation via SET ROLE app + SET LOCAL
// ---------------------------------------------------------------------------
describe("RLS cross-tenant isolation", () => {
  test("app role with tenant A's id cannot see tenant B's availability_links", async () => {
    const tenantA = await seedTenantWithLink({ tenantName: "Tenant A", email: "a@example.com" });
    const tenantB = await seedTenantWithLink({ tenantName: "Tenant B", email: "b@example.com" });

    // Query as app role scoped to tenant A — should only see tenant A's link.
    const rows = await queryAsApp("SELECT id FROM tenant.availability_links", tenantA.tenantId);

    const linkIds = rows.map((r) => r.id as string);
    expect(linkIds).toContain(tenantA.linkId);
    expect(linkIds).not.toContain(tenantB.linkId);
  });

  test("app role with no tenant_id set returns 0 rows from tenant tables (missing_ok=true)", async () => {
    await seedTenantWithLink({ tenantName: "Tenant C", email: "c@example.com" });

    // No SET LOCAL app.tenant_id → current_setting returns NULL → 0 rows
    const rows = await queryAsApp("SELECT id FROM tenant.availability_links", null);

    expect(rows).toHaveLength(0);
  });

  test("common.tenants is visible to app role regardless of app.tenant_id (no RLS)", async () => {
    const tenantA = await seedTenantWithLink({ tenantName: "Tenant D", email: "d@example.com" });
    const tenantB = await seedTenantWithLink({ tenantName: "Tenant E", email: "e@example.com" });

    // Even with tenant A's id set, app role should see both tenants (no RLS on common)
    const rows = await queryAsApp("SELECT id FROM common.tenants", tenantA.tenantId);

    const tenantIds = rows.map((r) => r.id as string);
    expect(tenantIds).toContain(tenantA.tenantId);
    expect(tenantIds).toContain(tenantB.tenantId);
  });
});
