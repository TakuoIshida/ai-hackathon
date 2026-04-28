/**
 * ISH-181 (Q-1): full RLS coverage — every tenant table × every CRUD op.
 *
 * `rls-poc.test.ts` (D-3) only smokes `availability_links`. This file
 * data-drives the same cross-tenant assertions across all 8 tenant tables so
 * a regression on any single table (e.g. accidentally dropping `TO app` or
 * forgetting WITH CHECK on a new policy) trips the suite immediately.
 *
 * Per table we assert:
 *  - SELECT: tenant A context cannot see tenant B's row
 *  - INSERT: writing tenant B's id while context = A is rejected by WITH CHECK
 *  - UPDATE: cross-tenant UPDATE matches 0 rows
 *  - DELETE: cross-tenant DELETE matches 0 rows
 *
 * Connections:
 *  - testDb (superuser) → seeds rows that bypass RLS so we have known fixtures
 *  - rawSql.begin() with `SET LOCAL ROLE app` → exercises the policy
 *
 * Parameterized queries throughout: never string-concat tenant_id into SQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ulid } from "ulidx";
import { createTestDb, type TestDb } from "@/test/integration-db";

let testDb: TestDb;
let rawSql: postgres.Sql;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for rls-coverage tests");

  testDb = await createTestDb();

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
// Fixture: per-tenant minimal parent rows (tenant + user + link + oauth account).
// Returns ids for downstream row factories. Created with the superuser
// connection so RLS doesn't block the seed itself.
// ---------------------------------------------------------------------------
type TenantFixture = {
  tenantId: string;
  userId: string;
  linkId: string;
  oauthAccountId: string;
};

async function seedTenantFixture(label: string): Promise<TenantFixture> {
  const tenantId = ulid();
  const userId = ulid();
  const linkId = ulid();
  const oauthAccountId = ulid();
  const externalId = `clerk_${randomUUID()}`;
  const slug = `slug-${label}-${randomUUID().slice(0, 8)}`;
  const googleUserId = `g_${randomUUID()}`;

  await rawSql`INSERT INTO common.tenants (id, name) VALUES (${tenantId}, ${`Tenant ${label}`})`;
  await rawSql`
    INSERT INTO common.users (id, external_id, email)
    VALUES (${userId}, ${externalId}, ${`${label}@example.com`})
  `;
  await rawSql`
    INSERT INTO tenant.availability_links
      (id, tenant_id, user_id, slug, title, duration_minutes, time_zone)
    VALUES
      (${linkId}, ${tenantId}, ${userId}, ${slug}, ${"Test"}, ${30}, ${"Asia/Tokyo"})
  `;
  await rawSql`
    INSERT INTO tenant.google_oauth_accounts
      (id, tenant_id, user_id, google_user_id, email,
       encrypted_refresh_token, refresh_token_iv, refresh_token_auth_tag, scope)
    VALUES
      (${oauthAccountId}, ${tenantId}, ${userId}, ${googleUserId}, ${`${label}@example.com`},
       ${"ct"}, ${"iv"}, ${"tag"}, ${"calendar.events"})
  `;
  return { tenantId, userId, linkId, oauthAccountId };
}

// ---------------------------------------------------------------------------
// Row factory: builds the column → value map for an INSERT into the table
// being tested. The factory takes a TenantFixture so it can reference parent
// FKs from the *correct* tenant, plus a salt so per-test rows don't collide
// on UNIQUE constraints.
// ---------------------------------------------------------------------------
type RowFactory = (fixture: TenantFixture, salt: string) => Record<string, unknown>;

type TableSpec = {
  /** Schema-qualified table for SQL strings. */
  table: string;
  /** Build an INSERT row for the given tenant. */
  buildRow: RowFactory;
  /** Column whose value is updated by the cross-tenant UPDATE assertion. */
  updateColumn: string;
  updateValue: string;
};

const SPECS: TableSpec[] = [
  {
    table: "tenant.invitations",
    buildRow: (f, salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      email: `inv-${salt}@example.com`,
      // token is uuid type; let DB default if not provided
      invited_by_user_id: f.userId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
    }),
    updateColumn: "email",
    updateValue: "pwned@example.com",
  },
  {
    table: "tenant.availability_links",
    buildRow: (f, salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      user_id: f.userId,
      slug: `evil-${salt}`,
      title: "Stolen",
      duration_minutes: 30,
      time_zone: "Asia/Tokyo",
    }),
    updateColumn: "title",
    updateValue: "pwned",
  },
  {
    table: "tenant.availability_rules",
    buildRow: (f, _salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      link_id: f.linkId,
      weekday: 1,
      start_minute: 540,
      end_minute: 1020,
    }),
    updateColumn: "start_minute",
    updateValue: "0",
  },
  {
    table: "tenant.availability_excludes",
    buildRow: (f, salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      link_id: f.linkId,
      // unique date per salt to avoid uniq_link_date conflicts
      local_date: `2027-01-${String((Math.abs(hashString(salt)) % 28) + 1).padStart(2, "0")}`,
    }),
    updateColumn: "local_date",
    updateValue: "2099-12-31",
  },
  {
    table: "tenant.bookings",
    buildRow: (f, salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      link_id: f.linkId,
      // start time is unique-per-salt so the per-link uniq_bookings_active_slot
      // partial index doesn't reject the cross-tenant INSERT for a reason
      // OTHER than RLS WITH CHECK (which is what we're testing).
      start_at: new Date(2030, 0, 1, (Math.abs(hashString(salt)) % 23) + 1).toISOString(),
      end_at: new Date(2030, 0, 1, ((Math.abs(hashString(salt)) % 23) + 1) % 23, 30).toISOString(),
      guest_name: "Guest",
      guest_email: "guest@example.com",
    }),
    updateColumn: "guest_name",
    updateValue: "pwned",
  },
  {
    table: "tenant.link_owners",
    buildRow: (f, _salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      link_id: f.linkId,
      user_id: f.userId,
    }),
    // link_owners has no nullable updateable text column; pretend updates touch
    // the FK timestamp via created_at would force casting. Instead we update
    // tenant_id itself — but RLS WITH CHECK should reject that too. To keep
    // the assertion symmetric with other tables we update user_id (text).
    updateColumn: "user_id",
    updateValue: "00000000-0000-0000-0000-000000000000",
  },
  {
    table: "tenant.google_oauth_accounts",
    buildRow: (f, salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      user_id: f.userId,
      google_user_id: `g-evil-${salt}`,
      email: `evil-${salt}@example.com`,
      encrypted_refresh_token: "ct",
      refresh_token_iv: "iv",
      refresh_token_auth_tag: "tag",
      scope: "calendar.events",
    }),
    updateColumn: "email",
    updateValue: "pwned@example.com",
  },
  {
    table: "tenant.google_calendars",
    buildRow: (f, salt) => ({
      id: ulid(),
      tenant_id: f.tenantId,
      oauth_account_id: f.oauthAccountId,
      google_calendar_id: `cal-${salt}`,
    }),
    updateColumn: "google_calendar_id",
    updateValue: "pwned-cal",
  },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ---------------------------------------------------------------------------
// Helper: build a parameterized INSERT against `table` from a column→value map.
// Returns the executed statement so callers can chain assertions.
// ---------------------------------------------------------------------------
async function execAppInsert(
  tx: postgres.TransactionSql,
  table: string,
  row: Record<string, unknown>,
): Promise<unknown> {
  const cols = Object.keys(row);
  const colsSql = cols.map((c) => `"${c}"`).join(", ");
  // postgres-js supports ${arr} for parameterized VALUES list
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = Object.values(row) as Array<string | number | boolean | null>;
  return tx.unsafe(`INSERT INTO ${table} (${colsSql}) VALUES (${placeholders})`, values);
}

async function seedRow(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  const colsSql = cols.map((c) => `"${c}"`).join(", ");
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = Object.values(row) as Array<string | number | boolean | null>;
  await rawSql.unsafe(`INSERT INTO ${table} (${colsSql}) VALUES (${placeholders})`, values);
}

// ---------------------------------------------------------------------------
// Data-driven RLS coverage suite.
// ---------------------------------------------------------------------------
describe("RLS cross-tenant isolation — full coverage (ISH-181)", () => {
  for (const spec of SPECS) {
    describe(spec.table, () => {
      test("SELECT: tenant A context cannot see tenant B row", async () => {
        const a = await seedTenantFixture("a");
        const b = await seedTenantFixture("b");

        const aRow = spec.buildRow(a, "select-a");
        const bRow = spec.buildRow(b, "select-b");
        await seedRow(spec.table, aRow);
        await seedRow(spec.table, bRow);

        const rows = await rawSql.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE app");
          await tx`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
          return tx.unsafe(`SELECT id FROM ${spec.table}`);
        });
        const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
        expect(ids).toContain(aRow.id as string);
        expect(ids).not.toContain(bRow.id as string);
      });

      test("INSERT: cross-tenant tenant_id rejected by WITH CHECK", async () => {
        const a = await seedTenantFixture("a");
        const b = await seedTenantFixture("b");
        // Build the row pointing FK references at tenant B (so FK doesn't
        // reject for a reason unrelated to RLS) but execute the INSERT under
        // tenant A's context.
        const stolen = spec.buildRow(b, "insert-stolen");
        await expect(
          rawSql.begin(async (tx) => {
            await tx.unsafe("SET LOCAL ROLE app");
            await tx`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
            await execAppInsert(tx, spec.table, stolen);
          }),
        ).rejects.toThrow(/row-level security|new row violates row-level security/i);

        // Confirm the row never landed (admin-bypass count).
        const rows = await rawSql.unsafe(`SELECT id FROM ${spec.table} WHERE id = $1`, [
          stolen.id as string,
        ]);
        expect(rows as unknown as Array<{ id: string }>).toHaveLength(0);
      });

      test("UPDATE: cross-tenant row matches 0 rows", async () => {
        const a = await seedTenantFixture("a");
        const b = await seedTenantFixture("b");
        const bRow = spec.buildRow(b, "update");
        await seedRow(spec.table, bRow);

        const result = await rawSql.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE app");
          await tx`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
          return tx.unsafe(`UPDATE ${spec.table} SET "${spec.updateColumn}" = $1 WHERE id = $2`, [
            spec.updateValue,
            bRow.id as string,
          ]);
        });
        expect((result as { count: number }).count).toBe(0);

        // Tenant B's row is untouched.
        const rows = (await rawSql.unsafe(
          `SELECT "${spec.updateColumn}" AS v FROM ${spec.table} WHERE id = $1`,
          [bRow.id as string],
        )) as unknown as Array<{ v: unknown }>;
        expect(String(rows[0]?.v)).not.toBe(spec.updateValue);
      });

      test("DELETE: cross-tenant row matches 0 rows", async () => {
        const a = await seedTenantFixture("a");
        const b = await seedTenantFixture("b");
        const bRow = spec.buildRow(b, "delete");
        await seedRow(spec.table, bRow);

        const result = await rawSql.begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE app");
          await tx`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
          return tx.unsafe(`DELETE FROM ${spec.table} WHERE id = $1`, [bRow.id as string]);
        });
        expect((result as { count: number }).count).toBe(0);

        const rows = await rawSql.unsafe(`SELECT id FROM ${spec.table} WHERE id = $1`, [
          bRow.id as string,
        ]);
        expect(rows as unknown as Array<{ id: string }>).toHaveLength(1);
      });
    });
  }
});
