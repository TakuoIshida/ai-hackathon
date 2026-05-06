import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/clerk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/clerk-react")>();
  return {
    ...actual,
    UserButton: () => <div data-testid="user-button" />,
  };
});

import { DashboardLayout } from "./DashboardLayout";

describe("<DashboardLayout />", () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/availability-sharings" element={<div>Links Page</div>} />
            <Route path="/calendar" element={<div>Calendar Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders the Logo as the brand mark", () => {
    renderAt("/availability-sharings");
    const logo = screen.getByTestId("logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("aria-label", "Rips");
  });

  it("renders all nav items (with 設定 → チーム設定 rename) and the matched outlet", () => {
    renderAt("/availability-sharings");
    expect(screen.getByRole("link", { name: "空き時間リンク" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "カレンダー" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "未確定の調整" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "確定済の予定" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "フォーム" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "チーム設定" })).toBeInTheDocument();
    // 旧ラベルは存在しない
    expect(screen.queryByRole("link", { name: "設定" })).toBeNull();
    expect(screen.getByText("Links Page")).toBeInTheDocument();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });

  it("renders different children based on path", () => {
    renderAt("/calendar");
    expect(screen.getByText("Calendar Page")).toBeInTheDocument();
    expect(screen.queryByText("Links Page")).toBeNull();
  });

  it("renders help / feedback / invite buttons and the team picker on the right", () => {
    renderAt("/availability-sharings");
    expect(screen.getByTestId("topnav-help")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ヘルプ" })).toBeInTheDocument();
    expect(screen.getByTestId("topnav-feedback")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "フィードバック" })).toBeInTheDocument();
    const invite = screen.getByTestId("topnav-invite");
    expect(invite).toBeInTheDocument();
    expect(invite).toHaveTextContent("招待");
    const teamPicker = screen.getByTestId("topnav-team-picker");
    expect(teamPicker).toBeInTheDocument();
    expect(teamPicker).toHaveTextContent("team");
    expect(teamPicker).toHaveTextContent("チームアカウント");
  });

  it("opens the invite modal placeholder when 招待 is clicked", () => {
    renderAt("/availability-sharings");
    expect(screen.queryByTestId("invite-modal-placeholder")).toBeNull();
    fireEvent.click(screen.getByTestId("topnav-invite"));
    const modal = screen.getByTestId("invite-modal-placeholder");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveTextContent(/TODO/);
  });
});
