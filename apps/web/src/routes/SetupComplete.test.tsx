/**
 * SetupComplete tests (ISH-242 / ISH-255 / O-03)
 *
 * - render: 主要な要素 (heading / 連携 calendar / success callout / CTA) が出る
 * - radio 切替: クリックで選択 calendar が切り替わり、登録先 badge が移動する
 * - CTA: 「セットアップを完了」 → updateCalendarFlags が呼ばれて
 *        /availability-sharings へ navigate
 * - not-connected: 連携情報が空のときは Google 連携 CTA を出す
 * - auth gate: 未サインインだと /sign-in へリダイレクト
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { GoogleCalendarSummary, GoogleConnection } from "@/lib/types";

const authMockState: { isSignedIn: boolean; isLoaded: boolean } = {
  isSignedIn: true,
  isLoaded: true,
};

vi.mock("@clerk/clerk-react", () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  // Stable getToken reference — Settings.test.tsx と同じ理由で factory 内に
  // 定義する。毎 render 新しい closure を返すと、load の useCallback が
  // 再生成されて useEffect が無限ループに陥り、API mock が settle しない。
  const getToken = async () => "fake-token";
  return {
    useAuth: () => ({
      isLoaded: authMockState.isLoaded,
      isSignedIn: authMockState.isSignedIn,
      userId: authMockState.isSignedIn ? "user_test" : null,
      getToken,
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

// ApiError と googleConnectUrl は real のまま、API 呼び出しのみ stub する。
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getGoogleConnection: vi.fn(),
      updateCalendarFlags: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import SetupComplete from "./SetupComplete";

const mockedApi = vi.mocked(api);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const calPrimary: GoogleCalendarSummary = {
  id: "cal-primary",
  googleCalendarId: "suzuki@team.example.com",
  summary: "suzuki@team.example.com",
  timeZone: "Asia/Tokyo",
  isPrimary: true,
  usedForBusy: true,
  usedForWrites: true,
};
const calWork: GoogleCalendarSummary = {
  id: "cal-work",
  googleCalendarId: "work@team.example.com",
  summary: "仕事用カレンダー",
  timeZone: "Asia/Tokyo",
  isPrimary: false,
  usedForBusy: true,
  usedForWrites: false,
};
const calPersonal: GoogleCalendarSummary = {
  id: "cal-personal",
  googleCalendarId: "personal@example.com",
  summary: "個人イベント",
  timeZone: "Asia/Tokyo",
  isPrimary: false,
  usedForBusy: false,
  usedForWrites: false,
};

const connected = (overrides: Partial<GoogleConnection> = {}): GoogleConnection => ({
  connected: true,
  accountEmail: "suzuki@team.example.com",
  calendars: [calPrimary, calWork, calPersonal],
  ...overrides,
});

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
  vi.clearAllMocks();
  authMockState.isSignedIn = true;
  authMockState.isLoaded = true;
  // Default: 3 calendars connected
  mockedApi.getGoogleConnection.mockResolvedValue(connected());
});

describe("<SetupComplete />", () => {
  test("renders heading, calendar options from API, success callout, CTA", async () => {
    renderRoute();
    expect(
      screen.getByRole("heading", { name: "予定を登録するカレンダーを選択" }),
    ).toBeInTheDocument();
    // API から返った 3 件の calendar radio
    expect(
      await screen.findByRole("radio", { name: "suzuki@team.example.com" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "仕事用カレンダー" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "個人イベント" })).toBeInTheDocument();
    // success callout
    expect(screen.getByText("Googleカレンダーの連携が完了しました")).toBeInTheDocument();
    // CTA
    expect(screen.getByRole("button", { name: /セットアップを完了/ })).toBeInTheDocument();
  });

  test("calendar with usedForWrites=true is selected by default and shows 登録先 badge", async () => {
    renderRoute();
    // Initial selection は usedForWrites=true の calPrimary
    const primaryRadio = await screen.findByRole("radio", {
      name: "suzuki@team.example.com",
    });
    await waitFor(() => expect(primaryRadio).toHaveAttribute("aria-checked", "true"));
    expect(screen.getAllByText("登録先")).toHaveLength(1);
  });

  test("falls back to isPrimary when no calendar has usedForWrites", async () => {
    // どの calendar も usedForWrites=false なケース
    mockedApi.getGoogleConnection.mockResolvedValueOnce(
      connected({
        calendars: [
          { ...calPrimary, usedForWrites: false },
          { ...calWork, usedForWrites: false },
          { ...calPersonal, usedForWrites: false },
        ],
      }),
    );
    renderRoute();
    const primaryRadio = await screen.findByRole("radio", {
      name: "suzuki@team.example.com",
    });
    await waitFor(() => expect(primaryRadio).toHaveAttribute("aria-checked", "true"));
  });

  test("falls back to first calendar when no usedForWrites and no primary", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce(
      connected({
        calendars: [
          { ...calWork, isPrimary: false, usedForWrites: false },
          { ...calPersonal, isPrimary: false, usedForWrites: false },
        ],
      }),
    );
    renderRoute();
    const firstRadio = await screen.findByRole("radio", {
      name: "仕事用カレンダー",
    });
    await waitFor(() => expect(firstRadio).toHaveAttribute("aria-checked", "true"));
  });

  test("clicking another calendar moves the selection and 登録先 badge", async () => {
    renderRoute();
    const workRadio = await screen.findByRole("radio", {
      name: "仕事用カレンダー",
    });
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

  test("renders only 1 calendar when API returns just one", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce(connected({ calendars: [calPrimary] }));
    renderRoute();
    expect(
      await screen.findByRole("radio", { name: "suzuki@team.example.com" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "仕事用カレンダー" })).toBeNull();
    // callout の件数表示も追従
    expect(screen.getByText(/1件のカレンダーから空き時間を自動検出します/)).toBeInTheDocument();
  });

  test("clicking 「セットアップを完了」 calls updateCalendarFlags then navigates", async () => {
    mockedApi.updateCalendarFlags.mockResolvedValue({
      calendar: { ...calPrimary, usedForWrites: true },
    });
    renderRoute([
      {
        path: "/availability-sharings",
        element: <div>landed-on-dashboard</div>,
      },
    ]);
    // Wait for load to settle
    await screen.findByRole("radio", { name: "suzuki@team.example.com" });
    // 仕事用に切り替えて、その id で flag を更新するか確認
    fireEvent.click(screen.getByRole("radio", { name: "仕事用カレンダー" }));

    fireEvent.click(screen.getByRole("button", { name: /セットアップを完了/ }));

    await waitFor(() => expect(mockedApi.updateCalendarFlags).toHaveBeenCalledTimes(1));
    expect(mockedApi.updateCalendarFlags).toHaveBeenCalledWith(
      "cal-work",
      { usedForWrites: true },
      expect.any(Function),
    );
    expect(await screen.findByText("landed-on-dashboard")).toBeInTheDocument();
  });

  test("not-connected state shows Google connect link instead of complete CTA", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce({
      connected: false,
      calendars: [],
    });
    renderRoute();
    expect(await screen.findByText("Google アカウントが連携されていません")).toBeInTheDocument();
    // CTA は連携リンクに置換
    expect(screen.getByRole("link", { name: /Google アカウントを連携/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /セットアップを完了/ })).toBeNull();
  });

  test("submit error displays inline error and keeps the user on the page", async () => {
    const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    mockedApi.updateCalendarFlags.mockRejectedValueOnce(
      new ApiError(403, "forbidden", "403 forbidden"),
    );
    renderRoute([
      {
        path: "/availability-sharings",
        element: <div>landed-on-dashboard</div>,
      },
    ]);
    await screen.findByRole("radio", { name: "suzuki@team.example.com" });

    fireEvent.click(screen.getByRole("button", { name: /セットアップを完了/ }));

    await screen.findByText("セットアップに失敗しました");
    expect(screen.getByText(/403 forbidden/)).toBeInTheDocument();
    // navigate は起きていない
    expect(screen.queryByText("landed-on-dashboard")).toBeNull();
    // CTA は再び押下可能 (再試行できる)
    expect(screen.getByRole("button", { name: /セットアップを完了/ })).not.toBeDisabled();
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
