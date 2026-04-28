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
            <Route path="/dashboard" element={<div>Home Page</div>} />
            <Route path="/dashboard/links" element={<div>Links Page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows brand, all nav items, and the matched outlet", () => {
    renderAt("/dashboard");
    expect(screen.getByRole("heading", { level: 1, name: /AI Hackathon/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ダッシュボード" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "リンク" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "予約" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByText("Home Page")).toBeInTheDocument();
    expect(screen.getByTestId("user-button")).toBeInTheDocument();
  });

  it("renders different children based on path", () => {
    renderAt("/dashboard/links");
    expect(screen.getByText("Links Page")).toBeInTheDocument();
    expect(screen.queryByText("Home Page")).toBeNull();
  });
});
