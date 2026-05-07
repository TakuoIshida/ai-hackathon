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
      expired: true,
      role: "member",
    });
    renderAt("expired-token");
    expect(await screen.findByText("招待の有効期限が切れています")).toBeInTheDocument();
  });

  test("unauth: shows サインインして承認 button", async () => {
    authMockState.isSignedIn = false;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "member",
    });
    renderAt("good-token");
    expect(await screen.findByRole("button", { name: /サインインして承認/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /テナントに参加/ })).toBeNull();
  });

  test("welcome shell renders Logo, Stepper, team card, h1, and CTA (ISH-241)", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "member",
    });
    renderAt("good-token");

    // h1 + welcome copy
    expect(await screen.findByRole("heading", { name: "Ripsへようこそ" })).toBeInTheDocument();

    // Logo (top bar + center hero) — Logo component renders [data-testid="logo"]
    const logos = screen.getAllByTestId("logo");
    expect(logos.length).toBeGreaterThanOrEqual(1);

    // Stepper at current=0 → "招待を確認" is active
    const activeItem = screen.getByText("招待を確認").closest("li");
    expect(activeItem).toHaveAttribute("aria-current", "step");

    // Team card with workspace name
    const teamCard = screen.getByTestId("team-card");
    expect(teamCard).toHaveTextContent("Acme");
    expect(teamCard).toHaveTextContent("招待中");

    // Expires line
    expect(screen.getByTestId("expires-line")).toHaveTextContent(/残り/);

    // Primary CTA (auth-side: テナントに参加)
    expect(screen.getByRole("button", { name: /テナントに参加/ })).toBeInTheDocument();

    // Legal links
    expect(screen.getByRole("link", { name: "利用規約" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "プライバシーポリシー" })).toBeInTheDocument();
  });

  test("auth + accept: calls API and navigates to /dashboard", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "member",
    });
    mockedApi.acceptTenantInvitation.mockResolvedValueOnce({
      tenantId: "tenant-1",
      role: "member",
    });

    renderAt("good-token", [
      {
        path: "/availability-sharings",
        element: <div>landed-on-dashboard</div>,
      },
    ]);

    const joinBtn = await screen.findByRole("button", { name: /テナントに参加/ });
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
      expired: false,
      role: "member",
    });
    mockedApi.acceptTenantInvitation.mockRejectedValueOnce(
      new ApiError(409, "already_accepted", "409 already_accepted"),
    );

    renderAt("good-token", [
      {
        path: "/availability-sharings",
        element: <div>landed-on-dashboard</div>,
      },
    ]);

    const joinBtn = await screen.findByRole("button", { name: /テナントに参加/ });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(mockedApi.acceptTenantInvitation).toHaveBeenCalled());
    expect(await screen.findByText("landed-on-dashboard")).toBeInTheDocument();
  });

  test("auth + accept 404 email-mismatch (collapsed to not_found, ISH-194): shows error and does not navigate", async () => {
    // Per ISH-194 the BE no longer distinguishes a wrong-email caller from a
    // bogus token — both surface as 404 not_found to avoid leaking that the
    // token is otherwise live. The FE must still render the error and stay
    // on the page (no redirect).
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "member",
    });
    mockedApi.acceptTenantInvitation.mockRejectedValueOnce(
      new ApiError(404, "not_found", "404 not_found"),
    );

    renderAt("good-token");
    const joinBtn = await screen.findByRole("button", { name: /テナントに参加/ });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/404 not_found/));
  });

  test("ISH-260: role='owner' invitation renders オーナー badge in team card and lead copy", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "owner",
    });
    renderAt("good-token");

    const badge = await screen.findByTestId("role-badge");
    expect(badge).toHaveTextContent("オーナー");
    // The lead copy mentions both the workspace name and the role.
    expect(screen.getByRole("heading", { name: "Ripsへようこそ" })).toBeInTheDocument();
    expect(screen.getByTestId("team-card")).toHaveTextContent("オーナー");
  });

  test("ISH-260: role='member' invitation renders メンバー badge", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "member",
    });
    renderAt("good-token");

    const badge = await screen.findByTestId("role-badge");
    expect(badge).toHaveTextContent("メンバー");
  });

  test("auth + accept 410 expired: shows error", async () => {
    authMockState.isSignedIn = true;
    mockedApi.getInvitation.mockResolvedValueOnce({
      workspace: { name: "Acme" },
      expired: false,
      role: "member",
    });
    mockedApi.acceptTenantInvitation.mockRejectedValueOnce(
      new ApiError(410, "expired", "410 expired"),
    );

    renderAt("good-token");
    const joinBtn = await screen.findByRole("button", { name: /テナントに参加/ });
    fireEvent.click(joinBtn);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/410 expired/));
  });
});
