import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { LinkSummary } from "@/lib/types";

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
    <MemoryRouter>
      <Links />
    </MemoryRouter>,
  );
}

describe("<Links />", () => {
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

    expect(await screen.findByText("30 minute intro")).toBeInTheDocument();
    expect(screen.getByText("Deep dive")).toBeInTheDocument();
    expect(screen.getByText("公開中")).toBeInTheDocument();
    expect(screen.getByText("下書き")).toBeInTheDocument();
  });

  test("shows the empty state when no links exist", async () => {
    mockedApi.listLinks.mockResolvedValue({ links: [] });

    renderLinks();

    await waitFor(() => expect(screen.getByText("まだリンクがありません")).toBeInTheDocument());
  });
});
