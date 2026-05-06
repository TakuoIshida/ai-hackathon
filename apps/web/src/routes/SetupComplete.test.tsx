/**
 * SetupComplete tests (ISH-242 / O-03)
 *
 * - render: 主要な要素 (heading / 3 件の calendar / success callout / CTA) が出る
 * - radio 切替: クリックで選択 calendar が切り替わり、登録先 badge が移動する
 * - CTA: 「セットアップを完了」 → /availability-sharings へ navigate
 * - auth gate: 未サインインだと /sign-in へリダイレクト
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const authMockState: { isSignedIn: boolean; isLoaded: boolean } = {
  isSignedIn: true,
  isLoaded: true,
};

vi.mock("@clerk/clerk-react", () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    useAuth: () => ({
      isLoaded: authMockState.isLoaded,
      isSignedIn: authMockState.isSignedIn,
      userId: authMockState.isSignedIn ? "user_test" : null,
      getToken: async () => "fake-token",
    }),
    useUser: () => ({
      isSignedIn: authMockState.isSignedIn,
      user: authMockState.isSignedIn
        ? { primaryEmailAddress: { emailAddress: "user@example.com" } }
        : null,
    }),
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

import SetupComplete from "./SetupComplete";

function renderRoute(landings: { path: string; element: React.ReactNode }[] = []) {
  return render(
    <MemoryRouter initialEntries={["/invite/abc/setup-calendar"]}>
      <Routes>
        <Route path="/invite/:token/setup-calendar" element={<SetupComplete />} />
        <Route path="/sign-in" element={<div>landed-on-sign-in</div>} />
        {landings.map((l) => (
          <Route key={l.path} path={l.path} element={l.element} />
        ))}
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authMockState.isSignedIn = true;
  authMockState.isLoaded = true;
});

describe("<SetupComplete />", () => {
  test("renders heading, 3 calendar options, success callout, CTA", () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "予定を登録するカレンダーを選択" }),
    ).toBeInTheDocument();
    // 3 件の calendar radio が出る
    expect(screen.getByRole("radio", { name: "suzuki@team.example.com" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "仕事用カレンダー" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "個人イベント" })).toBeInTheDocument();
    // success callout
    expect(screen.getByText("Googleカレンダーの連携が完了しました")).toBeInTheDocument();
    // CTA
    expect(screen.getByRole("button", { name: /セットアップを完了/ })).toBeInTheDocument();
  });

  test("primary calendar is selected by default and shows 登録先 badge", () => {
    renderRoute();
    const primaryRadio = screen.getByRole("radio", { name: "suzuki@team.example.com" });
    expect(primaryRadio).toHaveAttribute("aria-checked", "true");
    // 「登録先」 badge は初期状態で 1 つ
    expect(screen.getAllByText("登録先")).toHaveLength(1);
  });

  test("clicking another calendar moves the selection and 登録先 badge", () => {
    renderRoute();
    const workRadio = screen.getByRole("radio", { name: "仕事用カレンダー" });
    fireEvent.click(workRadio);
    expect(workRadio).toHaveAttribute("aria-checked", "true");
    // primary は選択解除されている
    expect(screen.getByRole("radio", { name: "suzuki@team.example.com" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // badge は依然 1 つ (移動しただけ)
    expect(screen.getAllByText("登録先")).toHaveLength(1);
  });

  test("clicking 「セットアップを完了」 navigates to /availability-sharings", () => {
    renderRoute([{ path: "/availability-sharings", element: <div>landed-on-dashboard</div> }]);
    const cta = screen.getByRole("button", { name: /セットアップを完了/ });
    fireEvent.click(cta);
    expect(screen.getByText("landed-on-dashboard")).toBeInTheDocument();
  });

  test("unsigned user is redirected to /sign-in", () => {
    authMockState.isSignedIn = false;
    renderRoute();
    expect(screen.getByText("landed-on-sign-in")).toBeInTheDocument();
  });

  test("renders nothing while auth SDK is still loading", () => {
    authMockState.isLoaded = false;
    const { container } = renderRoute();
    // root が空 (Routes 配下に何も描画されない)
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.queryByRole("button", { name: /セットアップを完了/ })).toBeNull();
  });
});
