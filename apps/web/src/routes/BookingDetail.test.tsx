import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
      getBooking: vi.fn(),
      cancelBooking: vi.fn(),
    },
  };
});

import { ApiError, api } from "@/lib/api";
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
    <MemoryRouter initialEntries={[`/confirmed-list/${id}`]}>
      <Routes>
        <Route path="/confirmed-list/:id" element={<BookingDetail />} />
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
  test("displays the booking detail fetched via getBooking(id)", async () => {
    mockedApi.getBooking.mockResolvedValue({ booking: futureBooking({ id: "b1" }) });

    renderAt("b1");

    expect(
      await screen.findByRole("heading", { level: 1, name: "30 minute intro" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://meet.google.com/abc-defg-hij" }),
    ).toBeInTheDocument();
    expect(mockedApi.getBooking).toHaveBeenCalledWith("b1", expect.any(Function));
  });

  // ISH-248: redesigned page is composed of 5 Card sections plus the cancel
  // banner / action footer.
  test("renders all 5 redesigned Card sections", async () => {
    mockedApi.getBooking.mockResolvedValue({ booking: futureBooking({ id: "b1" }) });

    renderAt("b1");

    // 1. 基本情報
    expect(await screen.findByRole("heading", { level: 2, name: "基本情報" })).toBeInTheDocument();
    expect(screen.getByText("日時")).toBeInTheDocument();
    expect(screen.getByText("所要時間")).toBeInTheDocument();
    expect(screen.getByText("30 分")).toBeInTheDocument();
    // リンク row points to the link edit page.
    expect(screen.getByRole("link", { name: /30 minute intro/ })).toHaveAttribute(
      "href",
      "/availability-sharings/l1/edit",
    );

    // 2. 主催者
    expect(screen.getByRole("heading", { level: 2, name: /主催者/ })).toBeInTheDocument();
    expect(screen.getByText("あなた")).toBeInTheDocument();

    // 3. 参加者 — guest + メール link
    expect(screen.getByRole("heading", { level: 2, name: /参加者/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /メールでメッセージ/ })).toHaveAttribute(
      "href",
      "mailto:alice@example.com",
    );

    // 4. 会議情報
    expect(screen.getByRole("heading", { level: 2, name: /会議情報/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meet を開く" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Google Calendar で開く/ })).toBeInTheDocument();

    // 5. アクション Footer — リスケ placeholder is disabled, cancel is active.
    expect(screen.getByRole("button", { name: "リスケ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "予約をキャンセル" })).toBeEnabled();
  });

  test("canceled state shows the rose-tone banner and hides the action footer", async () => {
    mockedApi.getBooking.mockResolvedValue({
      booking: futureBooking({
        status: "canceled",
        canceledAt: "2026-05-01T03:00:00Z",
      }),
    });

    renderAt("b1");

    // Banner shows up
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/キャンセル済/);

    // 「キャンセル済」 badge sits next to the heading too.
    expect(screen.getAllByText("キャンセル済").length).toBeGreaterThan(0);

    // Action footer is hidden — neither リスケ nor 予約をキャンセル button.
    expect(screen.queryByRole("button", { name: "リスケ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "予約をキャンセル" })).toBeNull();
  });

  test("renders the not_found empty state when the API returns 404", async () => {
    mockedApi.getBooking.mockRejectedValue(new ApiError(404, "not_found", "404 Not Found"));

    renderAt("missing-id");

    expect(await screen.findByText("予約が見つかりません")).toBeInTheDocument();
  });

  test("renders the error state when the API rejects with a non-404", async () => {
    mockedApi.getBooking.mockRejectedValue(new ApiError(500, "internal", "500"));

    renderAt("b1");

    expect(await screen.findByText(/500 internal/)).toBeInTheDocument();
  });

  test("cancel flow: confirm → API call → reload reflects canceled state", async () => {
    const confirmed = futureBooking({ id: "b1" });
    const canceled: BookingSummary = {
      ...confirmed,
      status: "canceled",
      canceledAt: new Date().toISOString(),
    };
    mockedApi.getBooking
      .mockResolvedValueOnce({ booking: confirmed })
      .mockResolvedValueOnce({ booking: canceled });
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
    expect(screen.getAllByText(/キャンセル済/).length).toBeGreaterThan(0);
  });
});
