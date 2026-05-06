import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { auth } from "@/auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";
import AcceptInvite from "@/routes/AcceptInvite";
import BookingDetail from "@/routes/BookingDetail";
import Bookings from "@/routes/Bookings";
import CancelBooking from "@/routes/CancelBooking";
import Landing from "@/routes/Landing";
import LinkForm from "@/routes/LinkForm";
import Links from "@/routes/Links";
import NotFound from "@/routes/NotFound";
import Onboarding from "@/routes/Onboarding";
import PublicLink from "@/routes/PublicLink";
import Settings from "@/routes/Settings";
import SetupComplete from "@/routes/SetupComplete";
import SignInPage from "@/routes/SignIn";
import SignUpPage from "@/routes/SignUp";

// ISH-225: dev-only component showcase. Lazy-loaded so it doesn't bloat the
// production bundle for normal users. Accessible at /dev/components in dev,
// or in prod when VITE_SHOW_DEV_ROUTES === "1".
const DevComponents = lazy(() => import("@/routes/DevComponents"));
const SHOW_DEV_ROUTES = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEV_ROUTES === "1";

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

/**
 * ISH-227: protected app shell. The `/dashboard` URL prefix has been removed —
 * authenticated routes now sit at the root (/availability-sharings,
 * /confirmed-list, /settings). The `:slug` public route remains in
 * `<PublicLayout />` and is matched only when the explicit named routes don't.
 */
function ProtectedApp() {
  if (!HAS_CLERK) return <Navigate to="/" replace />;
  return (
    <>
      <auth.SignedIn>
        <DashboardLayout />
      </auth.SignedIn>
      <auth.SignedOut>
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
          既に tenant 所属済みのユーザーは 409 already_member で
          /availability-sharings へ redirect。 */}
      <Route path="/onboarding" element={<Onboarding />} />

      {/* ISH-227: 旧 /dashboard prefix を撤去。すべてフラットに配置。
          ProtectedApp が auth gate を担う。 */}
      <Route element={<ProtectedApp />}>
        <Route path="/availability-sharings" element={<Links />} />
        <Route path="/availability-sharings/new" element={<LinkForm />} />
        <Route path="/availability-sharings/:id/edit" element={<LinkForm />} />
        <Route path="/confirmed-list" element={<Bookings />} />
        <Route path="/confirmed-list/:id" element={<BookingDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Backward-compat redirects for anyone hitting old /dashboard URLs. */}
      <Route path="/dashboard" element={<Navigate to="/availability-sharings" replace />} />
      <Route path="/dashboard/links" element={<Navigate to="/availability-sharings" replace />} />
      <Route path="/dashboard/bookings" element={<Navigate to="/confirmed-list" replace />} />
      <Route path="/dashboard/settings" element={<Navigate to="/settings" replace />} />

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

      {/* ISH-241: AcceptInvite はフルスクリーン Welcome layout を内包するので
          PublicLayout の中央寄せ shell には乗せず、ルート直下に置く。 */}
      <Route path="invite/:token" element={<AcceptInvite />} />

      {/* ISH-242 (O-03): Setup-complete 画面。AcceptInvite (O-02) → Google
          OAuth 完了後の遷移先。full-bleed の 2-column layout なので
          PublicLayout の中央寄せラッパーは経由させない。 */}
      <Route path="/invite/:token/setup-calendar" element={<SetupComplete />} />

      <Route element={<PublicLayout />}>
        <Route path="cancel/:token" element={<CancelBooking />} />
        <Route path=":slug" element={<PublicLink />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
