import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import type { UseAuthResult } from "@/auth";

// Mock the auth adapter so we can control isLoaded/isSignedIn without a real
// Clerk environment. AuthGuard reads `auth.useAuth()`, so mocking @/auth keeps
// the test invariant under future provider swaps. vi.mock is hoisted, so this
// runs before any imports below.
const mockUseAuth = vi.fn<() => UseAuthResult>(() => ({
  isLoaded: true,
  isSignedIn: true,
  externalId: "user_test",
  getToken: async () => "fake-token",
}));

vi.mock("@/auth", () => ({
  auth: { useAuth: () => mockUseAuth() },
}));

import { AuthGuard } from "./AuthGuard";

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route
          path="/protected"
          element={
            <AuthGuard>
              <p>protected content</p>
            </AuthGuard>
          }
        />
        <Route path="/sign-in" element={<p>sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthGuard", () => {
  test("renders children when user is signed in", () => {
    mockUseAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      externalId: "user_signed_in",
      getToken: async () => "fake-token",
    });

    renderProtected();

    expect(screen.getByText("protected content")).toBeInTheDocument();
    expect(screen.queryByText("sign-in page")).not.toBeInTheDocument();
  });

  test("redirects to /sign-in when user is not signed in", () => {
    mockUseAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
      externalId: null,
      getToken: async () => null,
    });

    renderProtected();

    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });

  test("renders nothing while the auth adapter is still loading (no flash redirect)", () => {
    mockUseAuth.mockReturnValue({
      isLoaded: false,
      isSignedIn: false,
      externalId: null,
      getToken: async () => null,
    });

    renderProtected();

    // Neither the children nor the sign-in destination should render — the
    // guard waits for isLoaded before deciding.
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.queryByText("sign-in page")).not.toBeInTheDocument();
  });
});
