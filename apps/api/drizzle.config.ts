import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Single entry that re-exports every schema file. Avoids drizzle-kit
  // trying to load co-located *.test.ts files (which fail on `bun:test`).
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    // Prefer admin role for migrations (BYPASSRLS + DDL).
    // Falls back to DATABASE_URL for local dev without a separate admin credential.
    url: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
