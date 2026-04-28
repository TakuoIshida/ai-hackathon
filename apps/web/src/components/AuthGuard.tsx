/**
 * AuthGuard — redirects unauthenticated users to /sign-in.
 *
 * Wraps children with a sign-in check using Clerk's useAuth hook. If the user
 * is not signed in, renders a <Navigate to="/sign-in" replace /> so React
 * Router handles the redirect without a full page reload.
 *
 * Usage:
 *   <AuthGuard>
 *     <ProtectedPage />
 *   </AuthGuard>
 *
 * Note: ProtectedDashboard in App.tsx already uses <SignedIn>/<SignedOut> with
 * Clerk's RedirectToSignIn for dashboard routes. This component is a
 * lightweight alternative for routes that need a self-contained auth check.
 */
import { useAuth } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";

type AuthGuardProps = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { isSignedIn } = useAuth();

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  return <>{children}</>;
}
