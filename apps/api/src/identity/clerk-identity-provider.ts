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

      // Prefer email from session claims (populated when the Clerk JWT template
      // includes `email` + `email_verified`). If not present we fall back to a
      // getUserByExternalId() lookup — callers that need a guaranteed email
      // should use getUserByExternalId instead of getClaims.
      const email = auth.sessionClaims?.email as string | undefined;
      const emailVerified = (auth.sessionClaims?.email_verified as boolean | undefined) ?? false;

      if (!email) return null;

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
