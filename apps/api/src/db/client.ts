import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

if (!url) {
  console.warn("[db] DATABASE_URL is not set — db queries will fail at runtime until you add it");
}

const sql = neon(url ?? "postgres://localhost/dev");
export const db = drizzle(sql, { schema });
export { schema };
