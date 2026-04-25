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
  root.render(<ClerkProvider publishableKey={PUBLISHABLE_KEY}>{tree}</ClerkProvider>);
} else {
  console.warn(
    "[clerk] VITE_CLERK_PUBLISHABLE_KEY is not set — rendering app without Clerk. Auth-gated UI will be hidden.",
  );
  root.render(tree);
}
