/**
 * AuthGuard — redirects unauthenticated users to /sign-in.
 *
 * Wraps children with a sign-in check using the auth adapter (NOT @clerk/clerk-react
 * directly), so the implementation stays vendor-neutral. If the user is not
 * signed in, renders <Navigate to="/sign-in" replace /> so React Router handles
 * the redirect without a full page reload.
 *
 * While the adapter is still loading (`isLoaded === false`) we render `null`
 * instead of redirecting — without this, the guard would briefly treat an
 * unloaded session as signed-out and flash-redirect signed-in users away.
 *
 * Usage:
 *   <AuthGuard>
 *     <ProtectedPage />
 *   </AuthGuard>
 */
import { Navigate } from "react-router-dom";
import { auth } from "@/auth";

type AuthGuardProps = {
  children: React.ReactNode;
};

export function AuthGuard({ children }: AuthGuardProps) {
  const { isLoaded, isSignedIn } = auth.useAuth();

  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}
