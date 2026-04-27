import type { BatchItem } from "drizzle-orm/batch";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Drizzle's `postgres-js` adapter does not expose `batch()` (that was a
 * `neon-http` affordance to compensate for the lack of callback
 * transactions). Repo modules derive `BatchQuery` from
 * `Parameters<Database["batch"]>` and rely on `db.batch()` to run multiple
 * statements atomically, so we keep the same surface here implemented on
 * top of postgres-js's real callback transactions.
 */
type Db = PostgresJsDatabase<typeof schema> & {
  batch<U extends BatchItem<"pg">, T extends Readonly<[U, ...U[]]>>(queries: T): Promise<unknown[]>;
};

let cachedDb: Db | null = null;
let testOverride: unknown = null;

function attachBatch(database: PostgresJsDatabase<typeof schema>): Db {
  const batch = async <U extends BatchItem<"pg">, T extends Readonly<[U, ...U[]]>>(
    queries: T,
  ): Promise<unknown[]> => {
    // postgres-js supports real callback transactions, so we wrap the
    // statements in a single tx. Atomicity matches the semantics that
    // neon-http's `db.batch()` previously provided over its HTTP transaction.
    return database.transaction(async (tx) => {
      const results: unknown[] = [];
      for (const q of queries) {
        // Each item is a drizzle query builder (a `SQLWrapper`); `tx.execute`
        // re-issues it against the transaction's connection so the statement
        // participates in the tx.
        results.push(await tx.execute(q as never));
      }
      return results;
    });
  };
  return Object.assign(database, { batch }) as Db;
}

function getDb(): Db {
  if (testOverride) return testOverride as Db;
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  // `prepare: false` keeps us compatible with PgBouncer-style transaction
  // pooling (used by the Cloud SQL Auth Proxy in some setups); `max` and
  // `idle_timeout` are serverless-friendly defaults. SSL behaviour is driven
  // entirely by the connection string (`?sslmode=require` for remote, none
  // for the local Auth Proxy).
  const sql = postgres(url, { max: 10, idle_timeout: 30, prepare: false });
  cachedDb = attachBatch(drizzle(sql, { schema }));
  return cachedDb;
}

// Test escape hatch: integration tests can swap in a different drizzle instance
// (a postgres-js handle bound to the test database) without rewriting routes
// that import `db` directly.
export function setDbForTests(db: unknown): void {
  testOverride = db;
}

export function clearDbForTests(): void {
  testOverride = null;
}

// Bind methods to the underlying drizzle instance so any internal `this` access
// (e.g. drizzle reaching its own session/dialect) works through the proxy.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const target = getDb();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
