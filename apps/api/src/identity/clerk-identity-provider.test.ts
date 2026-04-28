/**
 * ISH-192: pin the getClaims degraded-path behavior.
 *
 * The previous implementation returned null when `sessionClaims.email` was
 * absent, which 401'd every request from a user whose Clerk JWT template
 * hadn't been updated to include the email claim. We now return a valid
 * `IdentityClaims` with `email = ""` so existing users stay signed in, and
 * `attachDbUser` resolves the real user via DB lookup / `getUserByExternalId`.
 *
 * If the JWT template fix (ISH-174) ever lands, the empty-email path becomes
 * dead but harmless. These tests pin the resolution rules so a future
 * refactor doesn't accidentally re-introduce the 401 regression.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { IdentityProviderPort } from "@/ports/identity";
import { buildClerkIdentityProvider } from "./clerk-identity-provider";

const ORIGINAL_SECRET = process.env.CLERK_SECRET_KEY;
const ORIGINAL_PUB = process.env.CLERK_PUBLISHABLE_KEY;

beforeEach(() => {
  // Use a real-looking placeholder so we go down the production code path,
  // not the e2e bypass branch.
  process.env.CLERK_SECRET_KEY = "sk_test_unit_real_path";
  process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZXhhbXBsZS5jb20k";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = ORIGINAL_SECRET;
  if (ORIGINAL_PUB === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
  else process.env.CLERK_PUBLISHABLE_KEY = ORIGINAL_PUB;
});

/**
 * Set the auth state that @hono/clerk-auth's getAuth() reads from the context.
 * Mirrors what clerkMiddleware does after JWT verification — letting us
 * exercise getClaims() without standing up a real Clerk session.
 */
function withFakeAuth(
  idp: IdentityProviderPort,
  authState: {
    userId: string | null;
    sessionClaims?: Record<string, unknown>;
  },
) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    // The internal key @hono/clerk-auth's getAuth() reads from. Hard-coded
    // here because the public API only exposes a higher-level middleware that
    // we'd need a real JWT to drive.
    c.set(
      "clerkAuth" as never,
      {
        userId: authState.userId,
        sessionClaims: authState.sessionClaims ?? null,
      } as never,
    );
    await next();
  });
  let captured: ReturnType<typeof idp.getClaims> = null;
  app.get("/probe", (c) => {
    captured = idp.getClaims(c);
    return c.json({ ok: true });
  });
  return { app, getCaptured: () => captured };
}

describe("buildClerkIdentityProvider — getClaims (ISH-192 degraded path)", () => {
  test("returns null when no Clerk session is present", async () => {
    const idp = buildClerkIdentityProvider();
    const { app, getCaptured } = withFakeAuth(idp, { userId: null });
    await app.request("/probe");
    expect(getCaptured()).toBeNull();
  });

  test("returns claims with empty email when email claim is absent (existing user mitigation)", async () => {
    const idp = buildClerkIdentityProvider();
    const { app, getCaptured } = withFakeAuth(idp, {
      userId: "user_no_email_claim",
      sessionClaims: { sub: "user_no_email_claim" }, // no email / email_verified
    });
    await app.request("/probe");
    const claims = getCaptured();
    expect(claims).not.toBeNull();
    expect(claims?.externalId).toBe("user_no_email_claim");
    expect(claims?.email).toBe("");
    expect(claims?.emailVerified).toBe(false);
  });

  test("returns full claims when JWT template includes email + email_verified", async () => {
    const idp = buildClerkIdentityProvider();
    const { app, getCaptured } = withFakeAuth(idp, {
      userId: "user_with_email",
      sessionClaims: {
        sub: "user_with_email",
        email: "user@example.com",
        email_verified: true,
      },
    });
    await app.request("/probe");
    const claims = getCaptured();
    expect(claims).toEqual({
      externalId: "user_with_email",
      email: "user@example.com",
      emailVerified: true,
    });
  });

  test("treats non-string email claim as missing (defensive against tampering)", async () => {
    const idp = buildClerkIdentityProvider();
    const { app, getCaptured } = withFakeAuth(idp, {
      userId: "user_weird_email",
      sessionClaims: { sub: "user_weird_email", email: 12345, email_verified: true },
    });
    await app.request("/probe");
    expect(getCaptured()?.email).toBe("");
  });

  test("treats non-boolean email_verified as false", async () => {
    const idp = buildClerkIdentityProvider();
    const { app, getCaptured } = withFakeAuth(idp, {
      userId: "user_weird_verified",
      sessionClaims: {
        sub: "user_weird_verified",
        email: "x@x.com",
        email_verified: "true", // string, not boolean
      },
    });
    await app.request("/probe");
    expect(getCaptured()?.emailVerified).toBe(false);
  });
});
