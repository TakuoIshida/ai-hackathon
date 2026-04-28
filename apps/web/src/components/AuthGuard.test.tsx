import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

// Mock @clerk/clerk-react so we can control isSignedIn without a real Clerk
// environment. vi.mock is hoisted, so this runs before any imports below.
type MockAuthState = { isSignedIn: boolean; getToken: () => Promise<string | null> };
const mockUseAuth = vi.fn<() => MockAuthState>(() => ({
  isSignedIn: true,
  getToken: async () => "fake-token",
}));

vi.mock("@clerk/clerk-react", () => ({
  useAuth: () => mockUseAuth(),
}));

import { AuthGuard } from "./AuthGuard";

describe("AuthGuard", () => {
  test("renders children when user is signed in", () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      getToken: async () => "fake-token",
    });

    render(
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

    expect(screen.getByText("protected content")).toBeInTheDocument();
    expect(screen.queryByText("sign-in page")).not.toBeInTheDocument();
  });

  test("redirects to /sign-in when user is not signed in", () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: false,
      getToken: async () => null,
    });

    render(
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

    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
    expect(screen.getByText("sign-in page")).toBeInTheDocument();
  });
});
