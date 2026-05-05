import { render, screen } from "@testing-library/react";
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
    render(
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

  it("shows brand, all nav items, and the matched outlet", () => {
    renderAt("/availability-sharings");
    expect(screen.getByRole("heading", { level: 1, name: /AI Hackathon/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "空き時間リンク" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "カレンダー" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "未確定の調整" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "確定済の予定" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "フォーム" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByText("Links Page")).toBeInTheDocument();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });

  it("renders different children based on path", () => {
    renderAt("/calendar");
    expect(screen.getByText("Calendar Page")).toBeInTheDocument();
    expect(screen.queryByText("Links Page")).toBeNull();
  });
});
