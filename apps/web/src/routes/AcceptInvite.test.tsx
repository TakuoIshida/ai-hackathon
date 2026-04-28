/**
 * AcceptInvite tests — new ISH-176 D-7 API shape:
 *   GET /invitations/:token         → { workspace: { name }, email, expired }
 *   POST /invitations/:token/accept → { tenantId, role }
 *                                    409 → navigate to /dashboard (already member)
 *                                    410 / 403 / 404 → show error
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";

// Stable getToken reference — without this, every render returns a fresh
// closure and `useCallback`-wrapped handlers re-fire `useEffect`, eating
// queued mockResolvedValueOnce responses. (See Settings.test.tsx.)
const getToken = async () => "fake-token";
const authMockState: { isSignedIn: boolean } = { isSignedIn: false };

vi.mock("@clerk/clerk-react", () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    useAuth: () => ({ getToken, isSignedIn: authMockState.isSignedIn, userId: null }),
    useUser: () => ({
      isSignedIn: authMockState.isSignedIn,
      user: authMockState.isSignedIn
        ? { primaryEmailAddress: { emailAddress: "invitee@example.com" } }
        : null,
    }),
    // Render the inner button and call the in-test sign-in trigger so the
    // unauth flow can be observed without the real Clerk modal.
    SignInButton: PassThrough,
    SignUpButton: PassThrough,
    SignOutButton: PassThrough,
    SignedIn: PassThrough,
    SignedOut: PassThrough,
    ClerkProvider: PassThrough,
    SignIn: () => null,
    SignUp: () => null,
    UserButton: () => null,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getInvitation: vi.fn(),
      acceptTenantInvitation: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import AcceptInvite from "./AcceptInvite";

const mockedApi = vi.mocked(api);

function renderAt(token: string, landing: { path: string; element: React.ReactNode }[] = []) {
  return render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<AcceptInvite />} />
        {landing.map((l) => (
          <Route key={l.path} path={l.path} element={l.element} />
        ))}
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMockState.isSignedIn = false;
});

describe("<AcceptInvite />", () => {
  test("token-not-found: shows 招待が見つかりません", async () => {
    mockedApi.getInvitation.mockRejectedValueOnce(new ApiError(404, "not_found", "404 not_found"));
    renderAt("missing-token");
    expect(await screen.findByText("招待が見つかりません")).toBeInTheDocument();
  });

  test("expired: shows the expired message", async () => {
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      email: "invitee@example.com",
      expired: true,
    });
    renderAt("expired-token");
    expect(await screen.findByText("招待の有効期限が切れています")).toBeInTheDocument();
  });

  test("unauth: shows サインインして承認 button", async () => {
    authMockState.isSignedIn = false;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      email: "invitee@example.com",
      expired: false,
    });
    renderAt("good-token");
    expect(await screen.findByRole("button", { name: "サインインして承認" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "テナントに参加" })).toBeNull();
  });

  test("auth + accept: calls API and navigates to /dashboard", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      email: "invitee@example.com",
      expired: false,
    });
    mockedApi.acceptTenantInvitation.mockResolvedValueOnce({
      tenantId: "tenant-1",
      role: "member",
    });

    renderAt("good-token", [
      {
        path: "/dashboard",
        element: <div>landed-on-dashboard</div>,
      },
    ]);

    const joinBtn = await screen.findByRole("button", { name: "テナントに参加" });
    fireEvent.click(joinBtn);

    await waitFor(() =>
      expect(mockedApi.acceptTenantInvitation).toHaveBeenCalledWith(
        "good-token",
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("landed-on-dashboard")).toBeInTheDocument();
  });

  test("409 already_accepted / user_already_in_tenant: navigates to /dashboard", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      email: "invitee@example.com",
      expired: false,
    });
    mockedApi.acceptTenantInvitation.mockRejectedValueOnce(
      new ApiError(409, "already_accepted", "409 already_accepted"),
    );

    renderAt("good-token", [
      {
        path: "/dashboard",
        element: <div>landed-on-dashboard</div>,
      },
    ]);

    const joinBtn = await screen.findByRole("button", { name: "テナントに参加" });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(mockedApi.acceptTenantInvitation).toHaveBeenCalled());
    expect(await screen.findByText("landed-on-dashboard")).toBeInTheDocument();
  });

  test("auth + accept 403 email_mismatch: shows error and does not navigate", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      email: "invitee@example.com",
      expired: false,
    });
    mockedApi.acceptTenantInvitation.mockRejectedValueOnce(
      new ApiError(403, "email_mismatch", "403 email_mismatch"),
    );

    renderAt("good-token");
    const joinBtn = await screen.findByRole("button", { name: "テナントに参加" });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/403 email_mismatch/));
  });

  test("auth + accept 410 expired: shows error", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      email: "invitee@example.com",
      expired: false,
    });
    mockedApi.acceptTenantInvitation.mockRejectedValueOnce(
      new ApiError(410, "expired", "410 expired"),
    );

    renderAt("good-token");
    const joinBtn = await screen.findByRole("button", { name: "テナントに参加" });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/410 expired/));
  });
});
