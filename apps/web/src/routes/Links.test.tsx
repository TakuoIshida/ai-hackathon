import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LinkSummary } from "@/lib/types";
import { TestQueryProvider } from "@/test/query-test-utils";

vi.mock("@clerk/clerk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/clerk-react")>();
  const getToken = async () => "fake-token";
  return {
    ...actual,
    useAuth: () => ({ getToken }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listLinks: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import Links from "./Links";

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

function renderLinks() {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <Links />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe("<Links />", () => {
  test("renders page header even before data loads", async () => {
    mockedApi.listLinks.mockResolvedValue({ links: [] });

    renderLinks();

    // Page header — H1 contains "リンク" so existing e2e (signin.spec.ts) keeps working.
    expect(screen.getByRole("heading", { name: "空き時間リンク" })).toBeInTheDocument();
    expect(
      screen.getByText("カレンダーから空き時間を共有して、相手に予約してもらいましょう"),
    ).toBeInTheDocument();
    // Search + filter + create CTA.
    expect(screen.getByPlaceholderText("リンクを検索")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /絞り込み/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /空き時間リンクを作成/ })).toBeInTheDocument();
  });

  test("renders a list of links from the API", async () => {
    const links: LinkSummary[] = [
      {
        id: "l1",
        slug: "intro-30",
        title: "30 minute intro",
        description: null,
        durationMinutes: 30,
        isPublished: true,
        timeZone: "Asia/Tokyo",
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:00Z",
      },
      {
        id: "l2",
        slug: "deep-dive",
        title: "Deep dive",
        description: null,
        durationMinutes: 60,
        isPublished: false,
        timeZone: "Asia/Tokyo",
        createdAt: "2026-04-02T00:00:00Z",
        updatedAt: "2026-04-02T00:00:00Z",
      },
    ];
    mockedApi.listLinks.mockResolvedValue({ links });

    renderLinks();

    // Title + slug both show up in the row meta.
    expect(await screen.findByText("30 minute intro")).toBeInTheDocument();
    expect(screen.getByText("Deep dive")).toBeInTheDocument();
    expect(screen.getByText(/\/intro-30/)).toBeInTheDocument();
    expect(screen.getByText(/\/deep-dive/)).toBeInTheDocument();
    // Duration badge.
    expect(screen.getByText("30分")).toBeInTheDocument();
    expect(screen.getByText("60分")).toBeInTheDocument();
    // Edit link in each row points at that row's edit page (1 per row).
    const editLinks = screen.getAllByRole("link", { name: "編集" });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0]).toHaveAttribute("href", "/availability-sharings/l1/edit");
    expect(editLinks[1]).toHaveAttribute("href", "/availability-sharings/l2/edit");
  });

  test("copy button writes the public URL to the clipboard", async () => {
    const links: LinkSummary[] = [
      {
        id: "l1",
        slug: "intro-30",
        title: "30 minute intro",
        description: null,
        durationMinutes: 30,
        isPublished: true,
        timeZone: "Asia/Tokyo",
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:00Z",
      },
    ];
    mockedApi.listLinks.mockResolvedValue({ links });

    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is read-only in modern jsdom — defineProperty bypasses the getter.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderLinks();

    const copyBtn = await screen.findByRole("button", { name: "リンクをコピー" });
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/intro-30`);
  });

  test("shows the empty state when no links exist", async () => {
    mockedApi.listLinks.mockResolvedValue({ links: [] });

    renderLinks();

    await waitFor(() => expect(screen.getByText("まだリンクがありません")).toBeInTheDocument());
    // 2 CTAs to /availability-sharings/new — page header + empty state — both should be present.
    const createCtas = screen.getAllByRole("link", { name: /空き時間リンクを作成/ });
    expect(createCtas.length).toBeGreaterThanOrEqual(2);
    expect(createCtas[0]).toHaveAttribute("href", "/availability-sharings/new");
  });

  test("shows the error state and lets the user retry", async () => {
    mockedApi.listLinks.mockRejectedValueOnce(new Error("boom"));

    renderLinks();

    await waitFor(() => expect(screen.getByText("読み込みに失敗しました")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
