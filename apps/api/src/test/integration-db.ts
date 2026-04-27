import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { type NeonQueryFunction, neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { clearDbForTests, schema, setDbForTests } from "@/db/client";

/**
 * Common adapter surface every test file uses on `testDb.$client`. Both the
 * PGlite path (local default, zero-setup) and the Neon HTTP path (CI, where a
 * real Postgres + a local Neon HTTP proxy are running as services) implement
 * this so test files do not need to know which backend they got.
 */
export interface TestDbClient {
  /** Run a raw SQL statement (used by `beforeEach` TRUNCATEs and a handful of
   * direct constraint checks in schema tests). */
  exec(sql: string): Promise<void>;
  /** Release adapter resources. PGlite frees the WASM heap; the HTTP path is
   * stateless so this is a no-op. Both implementations are safe to call once. */
  close(): Promise<void>;
}

/**
 * The drizzle instance returned by `createTestDb`. Typed as the production
 * `NeonHttpDatabase` shape so route / repo code that imports `db` (which is
 * neon-http in production) still typechecks against the test-injected db.
 *
 * At runtime it is one of:
 *  - **PGlite-backed** when `TEST_DATABASE_URL` is unset. This is the local
 *    dev default — no Docker required, no network. PGlite's drizzle adapter
 *    has no native `batch`, so a sequential shim is installed.
 *  - **NeonHttp-backed** when `TEST_DATABASE_URL` points at a Neon serverless
 *    HTTP proxy (CI). This matches the production driver exactly, including
 *    the atomic `db.batch()` semantics. No shim is needed.
 */
export type TestDb = NeonHttpDatabase<typeof schema> & { $client: TestDbClient };

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
  if (url) return createNeonHttpTestDb(url);
  return createPgliteTestDb();
}

// ---------------------------------------------------------------------------
// Neon HTTP path (CI)
// ---------------------------------------------------------------------------

let neonProxyConfigured = false;

/**
 * Re-route the Neon serverless driver's HTTP fetch endpoint so requests for
 * `db.localtest.me` go to the local proxy on `:4444/sql` over plain HTTP.
 * `db.localtest.me` is a public DNS name that resolves to `127.0.0.1`, so this
 * works on any runner. Idempotent — only configures once per process.
 *
 * Image: ghcr.io/timowilhelm/local-neon-http-proxy:main (see ci.yml services).
 */
function configureLocalNeonProxy(host: string): void {
  if (neonProxyConfigured) return;
  if (host !== "db.localtest.me") return;
  neonConfig.fetchEndpoint = (h) => `http://${h}:4444/sql`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
  neonProxyConfigured = true;
}

async function createNeonHttpTestDb(url: string): Promise<TestDb> {
  const parsed = new URL(url);
  configureLocalNeonProxy(parsed.hostname);

  const sql = neon(url);
  const db = drizzleNeon(sql, { schema });

  await applyMigrationsViaNeonHttp(sql);

  const client: TestDbClient = {
    async exec(stmt) {
      // The HTTP endpoint accepts a single statement per request; the migration
      // loader already splits on `--> statement-breakpoint`, and `beforeEach`
      // TRUNCATE strings happen to be single statements.
      await sql(stmt);
    },
    async close() {
      // HTTP-based driver is stateless — no resource to release. Implemented
      // so the existing `afterAll` callsites can stay unchanged.
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
async function applyMigrationsViaNeonHttp(sql: NeonQueryFunction<false, false>): Promise<void> {
  const probe = (await sql(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'workspaces'
     ) AS present`,
  )) as Array<{ present: boolean }>;
  if (probe[0]?.present) return;

  const stmts = await loadMigrationStatements();
  for (const stmt of stmts) {
    await sql(stmt);
  }
}

// ---------------------------------------------------------------------------
// PGlite path (local default)
// ---------------------------------------------------------------------------

async function createPgliteTestDb(): Promise<TestDb> {
  const client = new PGlite();
  await applyMigrationsViaPglite(client);

  const db = drizzlePglite(client, { schema });

  // PGlite's drizzle adapter has no `batch` method; production uses neon-http
  // which does. Provide a sequential shim so repo code (which assumes batch) works.
  // The Neon HTTP path does not need this — the proxy passes the real batch
  // semantics through to Postgres.
  if (typeof (db as unknown as { batch?: unknown }).batch !== "function") {
    Object.assign(db, {
      batch: async (queries: ReadonlyArray<Promise<unknown>>) => {
        const results: unknown[] = [];
        for (const q of queries) results.push(await q);
        return results;
      },
    });
  }

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
