import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { auth } from "@/auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import AcceptInvite from "@/routes/AcceptInvite";
import BookingDetail from "@/routes/BookingDetail";
import Bookings from "@/routes/Bookings";
import CancelBooking from "@/routes/CancelBooking";
import DashboardHome from "@/routes/DashboardHome";
import Landing from "@/routes/Landing";
import LinkForm from "@/routes/LinkForm";
import Links from "@/routes/Links";
import NotFound from "@/routes/NotFound";
import Onboarding from "@/routes/Onboarding";
import PublicLink from "@/routes/PublicLink";
import Settings from "@/routes/Settings";
import SignInPage from "@/routes/SignIn";
import SignUpPage from "@/routes/SignUp";
import WorkspaceDetail from "@/routes/WorkspaceDetail";
import Workspaces from "@/routes/Workspaces";

// ISH-225: dev-only component showcase. Lazy-loaded so it doesn't bloat the
// production bundle for normal users. Accessible at /dev/components in dev,
// or in prod when VITE_SHOW_DEV_ROUTES === "1".
const DevComponents = lazy(() => import("@/routes/DevComponents"));
const SHOW_DEV_ROUTES = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEV_ROUTES === "1";

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function ProtectedDashboard() {
  if (!HAS_CLERK) return <Navigate to="/" replace />;
  return (
    <>
      <auth.SignedIn>
        <DashboardLayout />
      </auth.SignedIn>
      <auth.SignedOut>
        {/* ISH-178: RedirectToSignIn 相当を router 経由で実現 */}
        <Navigate to="/sign-in" replace />
      </auth.SignedOut>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      {/* ISH-55: dedicated in-app sign-in / sign-up routes. Wildcards let
          Clerk's components own their own subpaths (factor-one, verify-email,
          etc.) without requiring an explicit Route per step. */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />

      {/* ISH-179: onboarding — tenant 作成フロー。Sign-in/Sign-up 後に遷移する。
          既に tenant 所属済みのユーザーは 409 already_member で /dashboard へ redirect。 */}
      <Route path="/onboarding" element={<Onboarding />} />

      <Route path="/dashboard" element={<ProtectedDashboard />}>
        <Route index element={<DashboardHome />} />
        <Route path="links" element={<Links />} />
        <Route path="links/new" element={<LinkForm />} />
        <Route path="links/:id/edit" element={<LinkForm />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="workspaces" element={<Workspaces />} />
        <Route path="workspaces/:id" element={<WorkspaceDetail />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {SHOW_DEV_ROUTES && (
        <Route
          path="/dev/components"
          element={
            <Suspense fallback={null}>
              <DevComponents />
            </Suspense>
          }
        />
      )}

      <Route element={<PublicLayout />}>
        <Route path="cancel/:token" element={<CancelBooking />} />
        <Route path="invite/:token" element={<AcceptInvite />} />
        <Route path=":slug" element={<PublicLink />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
