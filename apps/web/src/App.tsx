import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import { Navigate, Route, Routes } from "react-router-dom";
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
import PublicLink from "@/routes/PublicLink";
import Settings from "@/routes/Settings";

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

function ProtectedDashboard() {
  if (!HAS_CLERK) return <Navigate to="/" replace />;
  return (
    <>
      <SignedIn>
        <DashboardLayout />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      <Route path="/dashboard" element={<ProtectedDashboard />}>
        <Route index element={<DashboardHome />} />
        <Route path="links" element={<Links />} />
        <Route path="links/new" element={<LinkForm />} />
        <Route path="links/:id/edit" element={<LinkForm />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="bookings/:id" element={<BookingDetail />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route element={<PublicLayout />}>
        <Route path="cancel/:token" element={<CancelBooking />} />
        <Route path="invite/:token" element={<AcceptInvite />} />
        <Route path=":slug" element={<PublicLink />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
