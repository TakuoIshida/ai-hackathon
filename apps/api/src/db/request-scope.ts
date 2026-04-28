import { AsyncLocalStorage } from "node:async_hooks";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";

/**
 * The transaction-bound DB slice that `attachTenantContext` propagates through
 * the request. Each key is typed to match the shape used in repos / usecases.
 */
export type RequestScope = {
  /** Drizzle transaction client scoped to the current HTTP request. */
  tx: PostgresJsDatabase<typeof schema>;
  /** Resolved tenant ULID for this request. */
  tenantId: string;
};

/**
 * AsyncLocalStorage that carries the request scope (transaction + tenantId)
 * through the async call chain without explicit argument threading.
 *
 * Lifecycle:
 *   1. `attachTenantContext` middleware opens a DB transaction, executes
 *      `SELECT set_config('app.tenant_id', tenantId, true)`, then calls
 *      `requestScope.run({ tx, tenantId }, () => next())`.
 *   2. Any code inside `next()` — repos, usecases — can retrieve the
 *      transaction via `getRequestScope()`.
 *   3. When `next()` resolves (or rejects), the transaction is committed /
 *      rolled back and the scope is automatically released.
 */
export const requestScope = new AsyncLocalStorage<RequestScope>();

/**
 * Returns the current request scope if one exists, or `null` outside of an
 * `attachTenantContext`-wrapped request (e.g. during migration, seed scripts,
 * tests that bypass the middleware stack).
 */
export function getRequestScope(): RequestScope | null {
  return requestScope.getStore() ?? null;
}
