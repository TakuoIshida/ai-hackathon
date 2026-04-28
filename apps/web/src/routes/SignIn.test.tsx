import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

// Mock Clerk's <SignIn />. The route's job is the surrounding shell + the
// bridging props (path / routing / signUpUrl / fallbackRedirectUrl); the
// Clerk component itself is exhaustively tested upstream.
vi.mock("@clerk/clerk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/clerk-react")>();
  return {
    ...actual,
    SignIn: (props: Record<string, unknown>) => (
      <div data-testid="clerk-sign-in" data-props={JSON.stringify(props)} />
    ),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderSignInAt(path: string) {
  // Re-import so the module-level HAS_CLERK reflects the current env stub.
  vi.resetModules();
  const { default: SignInPage } = await import("./SignIn");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/" element={<div data-testid="landing" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<SignInPage />", () => {
  test("renders the heading + Clerk component when VITE_CLERK_PUBLISHABLE_KEY is set", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    await renderSignInAt("/sign-in");

    expect(screen.getByRole("heading", { level: 1, name: "サインイン" })).toBeInTheDocument();
    const clerk = screen.getByTestId("clerk-sign-in");
    const props = JSON.parse(clerk.getAttribute("data-props") ?? "{}");
    expect(props.path).toBe("/sign-in");
    expect(props.routing).toBe("path");
    expect(props.signUpUrl).toBe("/sign-up");
    expect(props.fallbackRedirectUrl).toBe("/dashboard");
  });

  test("redirects to / when VITE_CLERK_PUBLISHABLE_KEY is unset", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    await renderSignInAt("/sign-in");

    expect(screen.getByTestId("landing")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "サインイン" })).not.toBeInTheDocument();
  });
});
