// E2E-only shim that replaces @clerk/clerk-react when the Vite build is
// invoked with VITE_E2E_BYPASS_AUTH=1. The shim:
//   - Treats every visitor as signed-in (so <SignedIn> renders, <SignedOut>
//     does not, and ProtectedDashboard does NOT redirect to /).
//   - Returns a no-op getToken from useAuth(); Playwright tests intercept all
//     API calls via page.route(), so the missing JWT is irrelevant.
//   - Is wired up via apps/web/vite.config.ts using a conditional resolve.alias
//     so production builds never import this file.
//
// Production builds (without VITE_E2E_BYPASS_AUTH=1) never see this module —
// vite-plugin-stylex emits the real @clerk/clerk-react bundle as before.
import type { ReactNode } from "react";

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedIn({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedOut(_: { children?: ReactNode }) {
  return null;
}

export function SignInButton({ children }: { children?: ReactNode; mode?: string }) {
  // The signin spec checks that this button is rendered on the landing page.
  // We render a plain button to keep markup parity with Clerk's modal trigger.
  return <>{children}</>;
}

// AcceptInvite (ISH-109) imports SignUpButton alongside SignInButton.
// Without this export the e2e production build fails with a rollup
// "ExportDefaultDeclaration.bind" error during shim resolution.
export function SignUpButton({ children }: { children?: ReactNode; mode?: string }) {
  return <>{children}</>;
}

export function RedirectToSignIn() {
  return null;
}

// ISH-55: dedicated /sign-in and /sign-up routes mount Clerk's <SignIn /> /
// <SignUp /> components. The e2e bundle never visits these routes (the spec
// asserts the post-auth dashboard) but the production build still imports
// them via App.tsx → SignIn/SignUp routes, so rollup needs the symbols to
// resolve. Render a placeholder so the routes stay observable if someone
// adds a future spec that hits them.
export function SignIn() {
  return <div data-testid="clerk-sign-in" />;
}

export function SignUp() {
  return <div data-testid="clerk-sign-up" />;
}

export function UserButton() {
  return <div data-testid="user-button" />;
}

// CRITICAL: stable references. Multiple components (BookingDetail, Bookings,
// LinkForm, etc.) declare `useAuth().getToken` in useEffect deps. If the
// shim returned a fresh closure on every render, those effects would loop
// forever and never stop firing GET /bookings, GET /links etc.
const stableGetToken = async () => "e2e-bypass-token";
const stableSignOut = async () => {};
const stableHas = () => false;
const stableAuth = {
  isLoaded: true,
  isSignedIn: true,
  userId: "user_e2e_test",
  sessionId: "sess_e2e_test",
  getToken: stableGetToken,
  signOut: stableSignOut,
  orgId: null,
  orgRole: null,
  orgSlug: null,
  has: stableHas,
  actor: null,
} as const;

const stableUser = {
  isLoaded: true,
  isSignedIn: true,
  user: {
    id: "user_e2e_test",
    primaryEmailAddress: { emailAddress: "e2e@example.com" },
    firstName: "E2E",
    lastName: "Test",
    fullName: "E2E Test",
  },
} as const;

export function useAuth() {
  return stableAuth;
}

export function useUser() {
  return stableUser;
}
