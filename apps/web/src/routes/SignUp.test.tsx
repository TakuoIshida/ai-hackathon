import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@clerk/clerk-react", () => ({
  SignUp: (props: Record<string, unknown>) => (
    <div data-testid="clerk-sign-up" data-props={JSON.stringify(props)} />
  ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function renderSignUpAt(path: string) {
  vi.resetModules();
  const { default: SignUpPage } = await import("./SignUp");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/" element={<div data-testid="landing" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<SignUpPage />", () => {
  test("renders the heading + Clerk component when VITE_CLERK_PUBLISHABLE_KEY is set", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    await renderSignUpAt("/sign-up");

    expect(screen.getByRole("heading", { level: 1, name: "サインアップ" })).toBeInTheDocument();
    const clerk = screen.getByTestId("clerk-sign-up");
    const props = JSON.parse(clerk.getAttribute("data-props") ?? "{}");
    expect(props.path).toBe("/sign-up");
    expect(props.routing).toBe("path");
    expect(props.signInUrl).toBe("/sign-in");
    expect(props.fallbackRedirectUrl).toBe("/dashboard");
  });

  test("redirects to / when VITE_CLERK_PUBLISHABLE_KEY is unset", async () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "");
    await renderSignUpAt("/sign-up");

    expect(screen.getByTestId("landing")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "サインアップ" })).not.toBeInTheDocument();
  });
});
