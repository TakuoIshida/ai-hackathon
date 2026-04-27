/**
 * Clerk 実装の AuthAdapter。
 *
 * - アプリコード (auth/ 以外) は @clerk/clerk-react を直接 import しない。
 * - VITE_CLERK_PUBLISHABLE_KEY 未設定時の分岐をこのファイルの Provider 内部に封じ込める。
 * - VITE_E2E_BYPASS_AUTH=1 時は vite.config.ts の alias により
 *   @clerk/clerk-react 全体が clerk-e2e-shim.tsx に差し替わるため、
 *   Provider / コンポーネントが shim 実装を使うことになる。
 */
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  SignInButton,
  SignOutButton,
  SignUp,
  SignUpButton,
  UserButton,
  useAuth as useClerkAuth,
} from "@clerk/clerk-react";
import type React from "react";
import type { AuthAdapter, UseAuthResult } from "./AuthAdapter";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function Provider({ children }: { children: React.ReactNode }) {
  if (!PUBLISHABLE_KEY) {
    // dev fallback: VITE_CLERK_PUBLISHABLE_KEY 未設定時は children をそのまま render。
    // Auth-gated UI (SignedIn/SignedOut) は各コンポーネントが shim 経由でハンドルする。
    console.warn(
      "[clerk] VITE_CLERK_PUBLISHABLE_KEY is not set — rendering app without Clerk. Auth-gated UI will be hidden.",
    );
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      {children}
    </ClerkProvider>
  );
}

function useAuth(): UseAuthResult {
  const { isSignedIn, userId, getToken } = useClerkAuth();
  return {
    isSignedIn: isSignedIn ?? false,
    externalId: userId ?? null,
    getToken,
  };
}

function ClerkSignInPage() {
  return (
    <SignIn path="/sign-in" routing="path" signUpUrl="/sign-up" fallbackRedirectUrl="/dashboard" />
  );
}

function ClerkSignUpPage() {
  return (
    <SignUp path="/sign-up" routing="path" signInUrl="/sign-in" fallbackRedirectUrl="/dashboard" />
  );
}

export const clerkAuthAdapter: AuthAdapter = {
  Provider,
  useAuth,
  SignInPage: ClerkSignInPage,
  SignUpPage: ClerkSignUpPage,
  SignOutButton,
  SignedIn,
  SignedOut,
  UserButton,
  SignInButton,
  SignUpButton,
};
