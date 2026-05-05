import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BookingSummary } from "@/lib/types";

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
      listBookings: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import Bookings from "./Bookings";

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

function renderBookings() {
  return render(
    <MemoryRouter>
      <Bookings />
    </MemoryRouter>,
  );
}

// Build a booking far enough in the future to land in the "upcoming" tab
// regardless of when this test happens to run.
function futureBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  const start = new Date(Date.now() + 7 * 86_400_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id: "b1",
    linkId: "l1",
    linkSlug: "intro-30",
    linkTitle: "30 minute intro",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    guestName: "Alice",
    guestEmail: "alice@example.com",
    status: "confirmed",
    meetUrl: null,
    canceledAt: null,
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

describe("<Bookings />", () => {
  test("renders the upcoming bookings list with a 詳細 link per row", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [
        futureBooking(),
        futureBooking({ id: "b2", linkTitle: "Deep dive", guestName: "Bob" }),
      ],
    });

    renderBookings();

    expect(await screen.findByText("30 minute intro")).toBeInTheDocument();
    expect(screen.getByText("Deep dive")).toBeInTheDocument();
    const detailLinks = screen.getAllByRole("link", { name: "詳細" });
    expect(detailLinks).toHaveLength(2);
    expect(detailLinks[0]).toHaveAttribute("href", "/confirmed-list/b1");
  });

  test("shows the empty state when no upcoming bookings exist", async () => {
    mockedApi.listBookings.mockResolvedValue({ bookings: [] });

    renderBookings();

    await waitFor(() => expect(screen.getByText("未来の予約はありません")).toBeInTheDocument());
  });
});
