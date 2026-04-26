import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(url);
  cachedDb = drizzle(sql, { schema });
  return cachedDb;
}

// Bind methods to the underlying drizzle instance so any internal `this` access
// (e.g. drizzle reaching its own session/dialect) works through the proxy.
export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const target = getDb();
    const value = Reflect.get(target, prop);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
