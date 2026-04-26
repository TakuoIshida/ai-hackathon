import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { BookingSummary } from "@/lib/types";

vi.mock("@clerk/clerk-react", () => {
  const getToken = async () => "fake-token";
  return {
    useAuth: () => ({ getToken }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listBookings: vi.fn(),
      cancelBooking: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import BookingDetail from "./BookingDetail";

const mockedApi = vi.mocked(api);

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
    meetUrl: "https://meet.google.com/abc-defg-hij",
    canceledAt: null,
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function renderAt(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/bookings/${id}`]}>
      <Routes>
        <Route path="/dashboard/bookings/:id" element={<BookingDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<BookingDetail />", () => {
  test("displays the booking detail for the matching id", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [futureBooking({ id: "b1" }), futureBooking({ id: "b2" })],
    });

    renderAt("b1");

    expect(
      await screen.findByRole("heading", { level: 1, name: "30 minute intro" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://meet.google.com/abc-defg-hij" }),
    ).toBeInTheDocument();
  });

  test("cancel flow: confirm → API call → reload reflects canceled state", async () => {
    const confirmed = futureBooking({ id: "b1" });
    const canceled: BookingSummary = {
      ...confirmed,
      status: "canceled",
      canceledAt: new Date().toISOString(),
    };
    mockedApi.listBookings
      .mockResolvedValueOnce({ bookings: [confirmed] })
      .mockResolvedValueOnce({ bookings: [canceled] });
    mockedApi.cancelBooking.mockResolvedValue({ ok: true });

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderAt("b1");

    const cancelButton = await screen.findByRole("button", { name: "予約をキャンセル" });
    fireEvent.click(cancelButton);

    await waitFor(() => expect(mockedApi.cancelBooking).toHaveBeenCalledTimes(1));
    expect(mockedApi.cancelBooking).toHaveBeenCalledWith("b1", expect.any(Function));
    expect(confirmSpy).toHaveBeenCalled();

    // After reload the canceled state is reflected: action button disappears.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "予約をキャンセル" })).toBeNull(),
    );
    expect(screen.getByText(/キャンセル済/)).toBeInTheDocument();
  });
});
