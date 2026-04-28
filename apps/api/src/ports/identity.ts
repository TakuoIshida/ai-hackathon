import type { Context, MiddlewareHandler } from "hono";

/**
 * Vendor-agnostic identity claims extracted from a verified session.
 * Intentionally minimal: only the 3 fields needed for identity resolution.
 * Clerk-specific concepts (Organizations, Metadata, sessionId) are NOT exposed.
 */
export type IdentityClaims = {
  /** Clerk: userId (sub) / Auth0: sub */
  externalId: string;
  email: string;
  emailVerified: boolean;
};

/**
 * Vendor-agnostic user profile fetched from the identity provider.
 * Used for lazy DB-user creation when the user first signs in.
 */
export type IdentityProfile = {
  externalId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

/**
 * Port interface for identity providers (Clerk, Auth0, etc.).
 * Replacing the vendor implementation only requires swapping the file that
 * implements this interface — app code (routes, usecases, middleware) is
 * unaffected.
 */
export type IdentityProviderPort = {
  /** Returns the vendor-specific hono MiddlewareHandler to attach to the app. */
  middleware: () => MiddlewareHandler;
  /**
   * Extracts identity claims from the hono context after the middleware has run.
   * Returns null when the request is unauthenticated.
   */
  getClaims: (c: Context) => IdentityClaims | null;
  /**
   * Fetches the full user profile from the identity provider by externalId.
   * Returns null when the user does not exist in the provider.
   */
  getUserByExternalId: (externalId: string) => Promise<IdentityProfile | null>;
};

// Augment Hono's ContextVariableMap so identity-related context keys are fully
// typed everywhere in the app. This is the only place the augmentation should
// live — all identity-aware middleware reads from these keys.
declare module "hono" {
  interface ContextVariableMap {
    identityClaims: IdentityClaims;
    /**
     * The active identity provider for this request (ISH-190). Stashed by
     * `attachAuth` so `attachDbUser` can call `getUserByExternalId` without
     * reaching for a module-level singleton.
     */
    idp: IdentityProviderPort;
  }
}
