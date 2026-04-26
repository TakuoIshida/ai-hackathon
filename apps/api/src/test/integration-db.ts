import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { clearDbForTests, schema, setDbForTests } from "@/db/client";

export type TestDb = PgliteDatabase<typeof schema> & { $client: PGlite };

const MIGRATIONS_DIR = join(import.meta.dir, "..", "..", "drizzle");

async function applyMigrations(client: PGlite): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries.filter((name) => name.endsWith(".sql")).sort();
  for (const file of sqlFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit emits `--> statement-breakpoint` between statements
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  await applyMigrations(client);
  const db = drizzle(client, { schema }) as TestDb;
  return db;
}

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
