import { ClerkProvider } from "@clerk/clerk-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

const root = createRoot(rootElement);

const tree = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

if (PUBLISHABLE_KEY) {
  // ISH-55: point Clerk at our in-app sign-in / sign-up routes so
  // <RedirectToSignIn /> (App.tsx ProtectedDashboard) and Clerk's internal
  // links stay inside the SPA shell instead of bouncing to Clerk's hosted page.
  root.render(
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/dashboard"
    >
      {tree}
    </ClerkProvider>,
  );
} else {
  console.warn(
    "[clerk] VITE_CLERK_PUBLISHABLE_KEY is not set — rendering app without Clerk. Auth-gated UI will be hidden.",
  );
  root.render(tree);
}
