import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

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
