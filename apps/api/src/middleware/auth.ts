import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db/client";
import { productionClerkPort } from "@/users/clerk-port";
import type { User } from "@/users/domain";
import { ensureUserByClerkId } from "@/users/usecase";

export const clerkAuth = clerkMiddleware;

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    throw new HTTPException(401, { message: "unauthorized" });
  }
  await next();
};

export function getClerkUserId(c: Context): string {
  const auth = getAuth(c);
  if (!auth?.userId) {
    throw new HTTPException(401, { message: "unauthorized" });
  }
  return auth.userId;
}

// Hono's typed variables. Routes that mount `attachDbUser` can read
// `c.get("dbUser")` with the correct type.
export type AuthVars = { dbUser: User };

// Resolves the Clerk user → DB user once per request and stashes it on the
// context. Mount this AFTER `clerkAuth()` + `requireAuth` on routes that need
// the local user record.
//
// The Clerk SDK adapter is built on each request via `productionClerkPort()`;
// the call is cheap (just a closure) and keeps the middleware stateless.
// Test stacks bypass `attachDbUser` and inject their own clerk-id-aware mw.
export const attachDbUser: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
  const clerkId = getClerkUserId(c);
  const dbUser = await ensureUserByClerkId(db, clerkId, productionClerkPort());
  c.set("dbUser", dbUser);
  await next();
};

export function getDbUser(c: Context<{ Variables: AuthVars }>): User {
  const dbUser = c.get("dbUser");
  if (!dbUser) {
    throw new HTTPException(500, { message: "dbUser missing — attachDbUser not mounted" });
  }
  return dbUser;
}
