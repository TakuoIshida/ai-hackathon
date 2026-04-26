import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let cachedDb: Db | null = null;
let testOverride: unknown = null;

function getDb(): Db {
  if (testOverride) return testOverride as Db;
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(url);
  cachedDb = drizzle(sql, { schema });
  return cachedDb;
}

// Test escape hatch: integration tests can swap in a different drizzle instance
// (e.g. PGlite-backed) without rewriting routes that import `db` directly.
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
