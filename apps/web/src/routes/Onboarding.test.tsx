import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";

// Stable getToken reference — avoids re-renders from unstable closures.
const getToken = async () => "fake-token";
const authMockState: { isSignedIn: boolean } = { isSignedIn: true };

vi.mock("@clerk/clerk-react", () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    useAuth: () => ({
      getToken,
      // `isLoaded: true` mirrors the Clerk SDK contract that AuthAdapter relies
      // on to gate redirects (avoids the loading-state flash).
      isLoaded: true,
      isSignedIn: authMockState.isSignedIn,
      userId: authMockState.isSignedIn ? "user-1" : null,
    }),
    SignedIn: PassThrough,
    SignedOut: PassThrough,
    ClerkProvider: PassThrough,
    SignIn: () => null,
    SignUp: () => null,
    SignInButton: PassThrough,
    SignUpButton: PassThrough,
    SignOutButton: PassThrough,
    UserButton: () => null,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      createTenant: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import Onboarding from "./Onboarding";

const mockedApi = vi.mocked(api);

function renderOnboarding(landing: { path: string; element: React.ReactNode }[] = []) {
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/sign-in" element={<div data-testid="sign-in-page" />} />
        <Route path="/" element={<div data-testid="landing-page" />} />
        {landing.map((l) => (
          <Route key={l.path} path={l.path} element={l.element} />
        ))}
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMockState.isSignedIn = true;
});

describe("<Onboarding />", () => {
  test("redirects to /sign-in when not signed in", async () => {
    authMockState.isSignedIn = false;
    renderOnboarding();
    expect(await screen.findByTestId("sign-in-page")).toBeInTheDocument();
  });

  test("renders form when signed in", async () => {
    authMockState.isSignedIn = true;
    renderOnboarding();
    expect(
      await screen.findByRole("heading", { level: 1, name: "テナントを作成" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "テナントを作成" })).toBeInTheDocument();
  });

  test("shows validation error when name is empty", async () => {
    authMockState.isSignedIn = true;
    renderOnboarding();
    await screen.findByRole("button", { name: "テナントを作成" });
    fireEvent.click(screen.getByRole("button", { name: "テナントを作成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("テナント名を入力してください");
    expect(mockedApi.createTenant).not.toHaveBeenCalled();
  });

  test("201 success: calls API and navigates to /dashboard", async () => {
    authMockState.isSignedIn = true;
    mockedApi.createTenant.mockResolvedValueOnce({
      tenantId: "tenant-1",
      name: "Acme",
      role: "owner",
    });

    renderOnboarding([
      { path: "/availability-sharings", element: <div data-testid="dashboard" /> },
    ]);

    await screen.findByRole("textbox");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme Inc." } });
    fireEvent.click(screen.getByRole("button", { name: "テナントを作成" }));

    await waitFor(() =>
      expect(mockedApi.createTenant).toHaveBeenCalledWith("Acme Inc.", expect.any(Function)),
    );
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
  });

  test("409 already_member: navigates to /dashboard without showing error", async () => {
    authMockState.isSignedIn = true;
    mockedApi.createTenant.mockRejectedValueOnce(
      new ApiError(409, "already_member", "409 already_member"),
    );

    renderOnboarding([
      { path: "/availability-sharings", element: <div data-testid="dashboard" /> },
    ]);

    await screen.findByRole("textbox");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme Inc." } });
    fireEvent.click(screen.getByRole("button", { name: "テナントを作成" }));

    await waitFor(() => expect(mockedApi.createTenant).toHaveBeenCalled());
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("400 error: shows error message in form", async () => {
    authMockState.isSignedIn = true;
    mockedApi.createTenant.mockRejectedValueOnce(
      new ApiError(400, "validation_error", "400 validation_error"),
    );

    renderOnboarding();

    await screen.findByRole("textbox");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bad" } });
    fireEvent.click(screen.getByRole("button", { name: "テナントを作成" }));

    await waitFor(() => expect(mockedApi.createTenant).toHaveBeenCalled());
    expect(await screen.findByRole("alert")).toHaveTextContent("入力内容を確認してください");
  });
});
