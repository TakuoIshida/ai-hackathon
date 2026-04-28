// NOTE: The users table has been moved to common.users (ISH-168 / D-1).
// This file re-exports from common.ts for backward compatibility during migration.
// Direct imports from "@/db/schema/users" still work, but prefer "@/db/schema/common".
export { type NewUser, type User, users } from "./common";
