import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { clearDbForTests, schema, setDbForTests } from "@/db/client";

/**
 * Common adapter surface every test file uses on `testDb.$client`. The harness
 * is now single-path: a real TCP Postgres reached via `TEST_DATABASE_URL`
 * (local docker-compose for dev, postgres:17-alpine service in CI). Tests do
 * not need to know which backend they got — they just call `exec` to run the
 * `beforeEach` TRUNCATE and `close` in `afterAll`.
 */
export interface TestDbClient {
  /** Run a raw SQL statement (used by `beforeEach` TRUNCATEs and a handful of
   * direct constraint checks in schema tests). */
  exec(sql: string): Promise<void>;
  /** Release adapter resources (closes the postgres-js connection pool).
   * Safe to call once per test file. */
  close(): Promise<void>;
}

/**
 * The drizzle instance returned by `createTestDb`. Typed as the production
 * `PostgresJsDatabase` shape so route / repo code that imports `db` still
 * typechecks against the test-injected db. The runtime backend is always
 * postgres-js connected to a real Postgres over TCP — no in-process WASM
 * tier — which means tests exercise the same driver as production.
 */
export type TestDb = PostgresJsDatabase<typeof schema> & { $client: TestDbClient };

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "drizzle");

const MISSING_URL_HINT = [
  "TEST_DATABASE_URL is required to run integration tests.",
  "",
  "Quick start (local dev):",
  "  docker compose -f docker-compose.dev.yml up -d",
  "  export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/app_dev",
  "",
  "Or, ad-hoc:",
  "  docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_test postgres:17-alpine",
  "  export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/app_test",
  "",
  "See apps/api/.env.example for the full list of test env vars.",
].join("\n");

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

/**
 * Build a fresh test DB handle bound to `TEST_DATABASE_URL`. Each call opens
 * its own postgres-js pool (`max: 1`), bootstraps the schema if it isn't
 * already present, and returns a drizzle instance with a `$client` adapter
 * and a `batch` shim attached.
 *
 * Schema bootstrap is idempotent: every test file in a CI batch shares the
 * same Postgres database, so the first call applies migrations and subsequent
 * calls (in the same process or a sibling process) find the schema already
 * there and skip. Per-test isolation is the caller's `beforeEach` TRUNCATE,
 * not a fresh schema.
 */
export async function createTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(MISSING_URL_HINT);
  }
  // `prepare: false` matches the production client and keeps us compatible
  // with poolers that don't tolerate prepared-statement state across
  // connections. `max: 1` keeps the test process from holding extra
  // connections to the Postgres container.
  // If the URL specifies sslmode=no-verify (e.g. self-signed CI containers),
  // translate it explicitly since postgres-js doesn't map it from the URL.
  const noVerify = new URL(url).searchParams.get("sslmode") === "no-verify";
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 5,
    prepare: false,
    ...(noVerify ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  const db = drizzle(sql, { schema });

  await applyMigrationsIfNeeded(sql);

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
 * the schema from a previous test file in this CI job (or a previous
 * `bun test` invocation against the local container). Uses the presence of
 * the `workspaces` table (added in 0002) as a quick sentinel — if it's there,
 * the schema is current and we skip re-applying. Per-test-file isolation
 * comes from each test's `beforeEach` TRUNCATE, not from re-running migrations.
 */
async function applyMigrationsIfNeeded(sql: postgres.Sql): Promise<void> {
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
// `batch` shim
//
// The production `db` (postgres-js) wraps a real callback transaction inside
// `db.batch()` (see `src/db/client.ts`). The postgres-js drizzle adapter
// doesn't expose a `batch` method natively, so repo modules that call
// `db.batch(...)` would break against a bare test instance. We install a
// transactional shim that mirrors the production semantics: each query runs
// inside a single callback transaction so the multi-statement atomicity that
// `links/repo.ts::createLink` and `workspaces/repo.ts::acceptInvitationAtomic`
// rely on is preserved in tests.
// ---------------------------------------------------------------------------

function attachBatchShim(db: PostgresJsDatabase<typeof schema>): void {
  if (typeof (db as { batch?: unknown }).batch === "function") return;
  Object.assign(db, {
    batch: async (queries: ReadonlyArray<unknown>) =>
      db.transaction(async (tx) => {
        const results: unknown[] = [];
        for (const q of queries) {
          // Each item is a drizzle query builder (a `SQLWrapper`); `tx.execute`
          // re-issues it against the transaction's connection so the statement
          // participates in the tx.
          results.push(await tx.execute(q as never));
        }
        return results;
      }),
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
