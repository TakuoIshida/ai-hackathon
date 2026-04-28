/**
 * ISH-182 (Q-2): common schema が RLS の影響を受けないことの不変条件 test。
 *
 * common.users / common.tenants / common.tenant_members は **すべての tenant
 * から横断的に参照される** ため RLS を掛けない設計 (docs/design/rls.md §1)。
 * 誤って ENABLE ROW LEVEL SECURITY が混入すると、
 *   - onboarding flow が tenant 作成前の自分自身を SELECT できなくなる
 *   - attachTenantContext が tenant_members を引けなくなり全 request が 403
 *   - admin tooling が users 一覧を引けなくなる
 * 等、極めて回復しにくい破壊が起きる。本 test で sentinel と SELECT 可視性を
 * 二重に pin する。
 *
 * 反対側 (tenant schema 全 8 テーブルが RLS を実装どおり掛けていること) は
 * `rls-coverage.test.ts` (ISH-181) でカバー済。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ulid } from "ulidx";
import { createTestDb, type TestDb } from "@/test/integration-db";

const COMMON_TABLES = ["users", "tenants", "tenant_members"] as const;

let testDb: TestDb;
let rawSql: postgres.Sql;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is required for rls-common-no-policy tests");

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
// Sentinel: common.* tables must NOT have RLS enabled. If anyone runs
// `ALTER TABLE common.X ENABLE ROW LEVEL SECURITY` (or adds `.enableRLS()` to
// the Drizzle schema), this test fires immediately.
// ---------------------------------------------------------------------------
describe("common schema — RLS is NOT enabled (ISH-182 sentinel)", () => {
  for (const table of COMMON_TABLES) {
    test(`pg_class.relrowsecurity is false on common.${table}`, async () => {
      const rows = await rawSql<Array<{ rowsecurity: boolean }>>`
        SELECT c.relrowsecurity AS rowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'common' AND c.relname = ${table}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rowsecurity).toBe(false);
    });

    test(`no policy is attached to common.${table}`, async () => {
      const rows = await rawSql<Array<{ policyname: string }>>`
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'common' AND tablename = ${table}
      `;
      expect(rows).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Behavior: app role with `app.tenant_id` set to A still sees rows that
// "belong" to tenant B (and rows that belong to no tenant). This pins the
// observable contract: common is a global lookup space, not tenant-scoped.
// ---------------------------------------------------------------------------
describe("common schema — visibility ignores app.tenant_id (ISH-182 behavior)", () => {
  test("tenants: SELECT returns rows from every tenant regardless of context", async () => {
    const ta = ulid();
    const tb = ulid();
    await rawSql`INSERT INTO common.tenants (id, name) VALUES (${ta}, 'Tenant A'), (${tb}, 'Tenant B')`;

    const rows = await rawSql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE app");
      await tx`SELECT set_config('app.tenant_id', ${ta}, true)`;
      return tx.unsafe(`SELECT id FROM common.tenants ORDER BY id`);
    });
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(ta);
    expect(ids).toContain(tb);
  });

  test("users: SELECT returns rows for users in different tenants", async () => {
    const ta = ulid();
    const tb = ulid();
    const ua = ulid();
    const ub = ulid();
    const uOrphan = ulid();
    await rawSql`INSERT INTO common.tenants (id, name) VALUES (${ta}, 'A'), (${tb}, 'B')`;
    await rawSql`
      INSERT INTO common.users (id, external_id, email) VALUES
        (${ua}, ${`clerk_${randomUUID()}`}, 'a@example.com'),
        (${ub}, ${`clerk_${randomUUID()}`}, 'b@example.com'),
        (${uOrphan}, ${`clerk_${randomUUID()}`}, 'orphan@example.com')
    `;
    await rawSql`
      INSERT INTO common.tenant_members (id, user_id, tenant_id, role) VALUES
        (${ulid()}, ${ua}, ${ta}, 'owner'),
        (${ulid()}, ${ub}, ${tb}, 'owner')
    `;

    const rows = await rawSql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE app");
      await tx`SELECT set_config('app.tenant_id', ${ta}, true)`;
      return tx.unsafe(`SELECT id FROM common.users`);
    });
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    // Same-tenant + cross-tenant + orphan all visible — no per-tenant filtering.
    expect(ids).toContain(ua);
    expect(ids).toContain(ub);
    expect(ids).toContain(uOrphan);
  });

  test("tenant_members: SELECT returns rows for both tenants regardless of context", async () => {
    const ta = ulid();
    const tb = ulid();
    const ua = ulid();
    const ub = ulid();
    await rawSql`INSERT INTO common.tenants (id, name) VALUES (${ta}, 'A'), (${tb}, 'B')`;
    await rawSql`
      INSERT INTO common.users (id, external_id, email) VALUES
        (${ua}, ${`clerk_${randomUUID()}`}, 'a@example.com'),
        (${ub}, ${`clerk_${randomUUID()}`}, 'b@example.com')
    `;
    await rawSql`
      INSERT INTO common.tenant_members (id, user_id, tenant_id, role) VALUES
        (${ulid()}, ${ua}, ${ta}, 'owner'),
        (${ulid()}, ${ub}, ${tb}, 'owner')
    `;

    const rows = await rawSql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE app");
      await tx`SELECT set_config('app.tenant_id', ${ta}, true)`;
      return tx.unsafe(`SELECT user_id, tenant_id FROM common.tenant_members ORDER BY user_id`);
    });
    const pairs = (rows as unknown as Array<{ user_id: string; tenant_id: string }>).map(
      (r) => `${r.user_id}:${r.tenant_id}`,
    );
    expect(pairs).toContain(`${ua}:${ta}`);
    expect(pairs).toContain(`${ub}:${tb}`);
  });

  test("common visibility holds even with NO app.tenant_id set (no fail-closed bleed-through)", async () => {
    const ta = ulid();
    const tb = ulid();
    await rawSql`INSERT INTO common.tenants (id, name) VALUES (${ta}, 'A'), (${tb}, 'B')`;

    const rows = await rawSql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE app");
      // Intentionally do NOT set app.tenant_id — tenant tables would return 0
      // rows here (rls-poc.test.ts pins that). common.* must remain visible.
      return tx.unsafe(`SELECT id FROM common.tenants`);
    });
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(ta);
    expect(ids).toContain(tb);
  });
});
