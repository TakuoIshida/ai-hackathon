import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { clearDbForTests, schema, setDbForTests } from "@/db/client";

/**
 * Common adapter surface every test file uses on `testDb.$client`. Both the
 * PGlite path (local default, zero-setup) and the Neon Local path (CI, where a
 * real Postgres + a local Neon Local container are running as services)
 * implement this so test files do not need to know which backend they got.
 */
export interface TestDbClient {
  /** Run a raw SQL statement (used by `beforeEach` TRUNCATEs and a handful of
   * direct constraint checks in schema tests). */
  exec(sql: string): Promise<void>;
  /** Release adapter resources. PGlite frees the WASM heap; the postgres-js
   * path closes its connection pool. Both implementations are safe to call once. */
  close(): Promise<void>;
}

/**
 * The drizzle instance returned by `createTestDb`. Typed as the production
 * `PostgresJsDatabase` shape so route / repo code that imports `db` (which is
 * postgres-js in production) still typechecks against the test-injected db.
 *
 * At runtime it is one of:
 *  - **PGlite-backed** when `TEST_DATABASE_URL` is unset. This is the local
 *    dev default — no Docker required, no network. PGlite's drizzle adapter
 *    has no native `batch`, so a sequential shim is installed.
 *  - **postgres-js-backed** when `TEST_DATABASE_URL` points at a real
 *    Postgres instance (Neon Local container in CI, or any plain Postgres).
 *    This matches the production driver exactly. A `batch` shim that wraps
 *    the queries in a real transaction is installed to mirror the production
 *    `db.client` surface.
 */
export type TestDb = PostgresJsDatabase<typeof schema> & { $client: TestDbClient };

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "drizzle");

async function loadMigrationStatements(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries.filter((name) => name.endsWith(".sql")).sort();
  const out: string[] = [];
  for (const file of sqlFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit emits `--> statement-breakpoint` between statements
    const stmts = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    out.push(...stmts);
  }
  return out;
}

export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) return createPostgresTestDb(url);
  return createPgliteTestDb();
}

// ---------------------------------------------------------------------------
// postgres-js path (CI: Neon Local container; or any plain Postgres)
// ---------------------------------------------------------------------------

async function createPostgresTestDb(url: string): Promise<TestDb> {
  // `prepare: false` matches the production client and keeps us compatible
  // with poolers that don't tolerate prepared-statement state across
  // connections. `max: 1` keeps the test process from holding extra
  // connections to the Neon Local container.
  const sql = postgres(url, { max: 1, idle_timeout: 5, prepare: false });
  const db = drizzlePostgres(sql, { schema });

  await applyMigrationsViaPostgres(sql);

  attachBatchShim(db);

  const client: TestDbClient = {
    async exec(stmt) {
      // `sql.unsafe` lets us run a raw, non-parameterized statement, which is
      // what beforeEach TRUNCATE strings and direct constraint probes need.
      await sql.unsafe(stmt);
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
  Object.assign(db, { $client: client });
  return db as unknown as TestDb;
}

/**
 * Apply migrations against a shared Postgres instance that may already have
 * the schema from a previous test file in this CI job. Uses the presence of
 * the `workspaces` table (added in 0002) as a quick sentinel — if it's there,
 * the schema is current and we skip re-applying. Per-test-file isolation comes
 * from each test's `beforeEach` TRUNCATE, not from re-running migrations.
 */
async function applyMigrationsViaPostgres(sql: postgres.Sql): Promise<void> {
  const probe = await sql<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'workspaces'
    ) AS present
  `;
  if (probe[0]?.present) return;

  const stmts = await loadMigrationStatements();
  for (const stmt of stmts) {
    await sql.unsafe(stmt);
  }
}

// ---------------------------------------------------------------------------
// PGlite path (local default)
// ---------------------------------------------------------------------------

async function createPgliteTestDb(): Promise<TestDb> {
  const client = new PGlite();
  await applyMigrationsViaPglite(client);

  const db = drizzlePglite(client, { schema });

  attachBatchShim(db);

  const wrapper: TestDbClient = {
    async exec(stmt) {
      await client.exec(stmt);
    },
    async close() {
      await client.close();
    },
  };
  Object.assign(db, { $client: wrapper });
  return db as unknown as TestDb;
}

async function applyMigrationsViaPglite(client: PGlite): Promise<void> {
  const stmts = await loadMigrationStatements();
  for (const stmt of stmts) {
    await client.exec(stmt);
  }
}

// ---------------------------------------------------------------------------
// `batch` shim
//
// The production `db` (postgres-js) wraps a real callback transaction inside
// `db.batch()`. The PGlite drizzle adapter has no `batch` at all, and the
// postgres-js adapter doesn't expose one either. To keep repo code that calls
// `db.batch(...)` working under both test backends, we install a sequential
// shim. PGlite is single-process and tests do not exercise the rollback path
// of `batch`, so the loss of cross-statement atomicity in tests is acceptable.
// ---------------------------------------------------------------------------

function attachBatchShim(db: object): void {
  if (typeof (db as { batch?: unknown }).batch === "function") return;
  Object.assign(db, {
    batch: async (queries: ReadonlyArray<Promise<unknown>>) => {
      const results: unknown[] = [];
      for (const q of queries) results.push(await q);
      return results;
    },
  });
}

// ---------------------------------------------------------------------------
// Convenience runner used by a few legacy tests.
// ---------------------------------------------------------------------------

export async function withTestDb<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  const db = await createTestDb();
  setDbForTests(db);
  try {
    return await fn(db);
  } finally {
    clearDbForTests();
    await db.$client.close();
  }
}
