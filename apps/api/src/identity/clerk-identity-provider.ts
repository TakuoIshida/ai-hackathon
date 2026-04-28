import { createClerkClient } from "@clerk/backend";
import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import type { Context, MiddlewareHandler } from "hono";
import type { IdentityClaims, IdentityProfile, IdentityProviderPort } from "@/ports/identity";

/**
 * Production Clerk implementation of IdentityProviderPort.
 *
 * This is the ONLY file in apps/api/src that may import @clerk/* or
 * @hono/clerk-auth. All other modules consume the IdentityProviderPort
 * interface so the vendor can be swapped without touching app code.
 *
 * Absorbs the logic that previously lived in users/clerk-port.ts
 * (ClerkPort.fetchUser → getUserByExternalId) so ClerkPort can be removed.
 */
export function buildClerkIdentityProvider(): IdentityProviderPort {
  // E2E bypass: when the API runs under apps/e2e (Playwright), Clerk's secret
  // is set to a placeholder ('sk_test_e2e_bypass'). createClerkClient and the
  // real clerkMiddleware both reject the fake key — detecting the bypass token
  // here lets us return a fully no-op port so the API boot doesn't crash and
  // /public/* / /health stay accessible. The FE shim handles auth-gated UI
  // separately. Does NOT affect production (real CLERK_SECRET_KEY → real path).
  const isE2EBypass = process.env.CLERK_SECRET_KEY === "sk_test_e2e_bypass";
  if (isE2EBypass) {
    return {
      middleware: (): MiddlewareHandler => async (_c, next) => {
        await next();
      },
      getClaims: () => null,
      getUserByExternalId: async () => null,
    };
  }

  // Lazy-init: the Clerk client is only constructed when buildClerkIdentityProvider()
  // is called (at app boot), not on every request. The secretKey read happens
  // once here — tests that set process.env before importing will pick it up.
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY ?? "",
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? "",
  });

  return {
    middleware: (): MiddlewareHandler => clerkMiddleware(),

    getClaims: (c: Context): IdentityClaims | null => {
      const auth = getAuth(c);
      if (!auth?.userId) return null;

      // ISH-192: degraded path when JWT template lacks `email` / `email_verified`.
      // Previously we returned null in that case, which 401'd every request from
      // existing users whose Clerk JWT template hadn't been updated yet. Now we
      // return claims with an empty email — `attachDbUser` resolves the real
      // user via the DB (existing user) or `getUserByExternalId` (lazy create
      // hits Clerk's API directly, which always has a real email). Callers MUST
      // NOT trust `claims.email` for business logic; use `getDbUser(c).email`
      // for that. Long-term solution: ISH-174 (configure JWT template).
      const rawEmail = auth.sessionClaims?.email;
      const email = typeof rawEmail === "string" ? rawEmail : "";
      const emailVerified = auth.sessionClaims?.email_verified === true;

      return {
        externalId: auth.userId,
        email,
        emailVerified,
      };
    },

    getUserByExternalId: async (externalId: string): Promise<IdentityProfile | null> => {
      try {
        const user = await clerk.users.getUser(externalId);
        const primaryEmail = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
        // Fall back to first email if primaryEmailAddressId is not set.
        const resolvedEmail = primaryEmail?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
        if (!resolvedEmail) return null;

        return {
          externalId: user.id,
          email: resolvedEmail,
          firstName: user.firstName,
          lastName: user.lastName,
        };
      } catch {
        // Clerk throws when the user does not exist or the secretKey is invalid.
        // Treat both as "user not found" so callers don't have to distinguish.
        return null;
      }
    },
  };
}
