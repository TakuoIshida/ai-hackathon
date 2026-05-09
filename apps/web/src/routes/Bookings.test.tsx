import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ListBookingsResponse } from "@/lib/api";
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
      exportBookingsCsv: vi.fn(),
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

// ISH-268: server-side pagination + filter. Helpers below build the new
// `ListBookingsResponse` shape `{ bookings, total, page, pageSize }`. Tests
// that previously asserted client-side filter behavior now drive the mock
// directly to simulate what the server would return.
function pagedResponse(
  bookings: BookingSummary[],
  overrides: Partial<ListBookingsResponse> = {},
): ListBookingsResponse {
  return {
    bookings,
    total: overrides.total ?? bookings.length,
    page: overrides.page ?? 1,
    pageSize: overrides.pageSize ?? 25,
    ...overrides,
  };
}

function futureBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  const start = new Date(Date.now() + 7 * 86_400_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id: "b1",
    linkId: "l1",
    linkSlug: "intro-30",
    linkTitle: "30 minute intro",
    hostUserId: "u-host-1",
    hostName: "Host One",
    hostEmail: "host1@example.com",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    guestName: "Alice",
    guestEmail: "alice@example.com",
    status: "confirmed",
    meetUrl: null,
    googleEventId: null,
    googleHtmlLink: null,
    canceledAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function canceledBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  const start = new Date(Date.now() + 3 * 86_400_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id: "c1",
    linkId: "l1",
    linkSlug: "intro-30",
    linkTitle: "Canceled meeting",
    hostUserId: "u-host-1",
    hostName: "Host One",
    hostEmail: "host1@example.com",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    guestName: "Dana",
    guestEmail: "dana@example.com",
    status: "canceled",
    meetUrl: null,
    googleEventId: null,
    googleHtmlLink: null,
    canceledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("<Bookings />", () => {
  test("renders the page header (H1 + sub + CSV エクスポート button enabled)", async () => {
    mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));

    renderBookings();

    expect(
      await screen.findByRole("heading", { name: "確定済の予定", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("確定した予約を一覧で確認できます")).toBeInTheDocument();
    // ISH-271: button is no longer disabled — clicking triggers the CSV
    // download path (covered separately below).
    expect(screen.getByRole("button", { name: /CSV エクスポート/ })).toBeEnabled();
  });

  test("renders 3 stat cards with mint / blue / rose tones", async () => {
    mockedApi.listBookings.mockResolvedValue(
      pagedResponse([
        futureBooking(),
        futureBooking({ id: "b2", linkTitle: "Deep dive", guestName: "Bob" }),
      ]),
    );

    renderBookings();

    // tones — StatCard sets data-tone on the root.
    const tiles = await screen.findAllByTestId("stat-card-icon-tile");
    expect(tiles).toHaveLength(3);
    const tones = tiles.map((t) => t.parentElement?.getAttribute("data-tone"));
    expect(tones).toEqual(["mint", "blue", "rose"]);

    // labels (StatCard label is a <p>; tab trigger is a <button>, so scope to <p>)
    expect(screen.getByText("今後の予定", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("今月の確定")).toBeInTheDocument();
    expect(screen.getByText("キャンセル")).toBeInTheDocument();
  });

  test("renders the 3 tabs and defaults to 今後の予定", async () => {
    mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));

    renderBookings();

    const upcoming = await screen.findByRole("tab", { name: "今後の予定" });
    const past = screen.getByRole("tab", { name: "過去" });
    const canceled = screen.getByRole("tab", { name: "キャンセル済" });
    expect(upcoming).toHaveAttribute("data-state", "active");
    expect(past).toHaveAttribute("data-state", "inactive");
    expect(canceled).toHaveAttribute("data-state", "inactive");
  });

  test("renders the table with 5 columns + an action column on rows", async () => {
    mockedApi.listBookings.mockResolvedValue(
      pagedResponse([
        futureBooking(),
        futureBooking({ id: "b2", linkTitle: "Deep dive", guestName: "Bob" }),
      ]),
    );

    renderBookings();

    // Wait for at least one row to render before checking column headers.
    // ISH-292: skeleton は Spinner 中央配置に変わったので header text 衝突は
    // 発生しないが、データ到着まで待つ意味で row title アンカーは維持。
    expect(await screen.findByText("Deep dive")).toBeInTheDocument();
    // Column headers
    expect(screen.getByText("日時")).toBeInTheDocument();
    expect(screen.getByText("タイトル")).toBeInTheDocument();
    expect(screen.getByText("主催者")).toBeInTheDocument();
    expect(screen.getByText("参加者")).toBeInTheDocument();
    expect(screen.getByText("ステータス")).toBeInTheDocument();

    // Two rows + 詳細 link per row
    expect(screen.getByText("30 minute intro")).toBeInTheDocument();
    expect(screen.getByText("Deep dive")).toBeInTheDocument();
    const detailLinks = screen.getAllByRole("link", { name: "詳細" });
    expect(detailLinks).toHaveLength(2);
    expect(detailLinks[0]).toHaveAttribute("href", "/confirmed-list/b1");

    // Confirmed badge
    const confirmedBadges = screen.getAllByText("確定");
    expect(confirmedBadges).toHaveLength(2);
  });

  test("switching to the canceled tab calls the API with status=canceled", async () => {
    // ISH-268: tab → server status mapping. upcoming/past tabs → confirmed,
    // canceled tab → canceled. Time-based "upcoming vs past" filtering moved
    // out of this issue's scope.
    mockedApi.listBookings.mockResolvedValue(pagedResponse([canceledBooking()]));

    renderBookings();

    // First fetch on mount: status=confirmed (default upcoming tab).
    await waitFor(() => expect(mockedApi.listBookings).toHaveBeenCalled());
    const firstCall = mockedApi.listBookings.mock.calls[0]?.[0];
    expect(firstCall?.status).toBe("confirmed");

    // Switch to canceled tab — Radix Tabs needs mouseDown (not click) under happy-dom.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "キャンセル済" }));

    await waitFor(() => {
      const lastCall =
        mockedApi.listBookings.mock.calls[mockedApi.listBookings.mock.calls.length - 1]?.[0];
      expect(lastCall?.status).toBe("canceled");
    });
  });

  test("shows the empty state when the server returns total=0", async () => {
    mockedApi.listBookings.mockResolvedValue(pagedResponse([], { total: 0 }));

    renderBookings();

    // データ無し empty state — illustration card with heading + CTA.
    await waitFor(() => expect(screen.getByText("予約はまだありません")).toBeInTheDocument());
    expect(screen.getByTestId("bookings-empty-no-data")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "リンクを作成" });
    expect(cta).toHaveAttribute("href", "/availability-sharings");
  });

  test("shows the error state with a 再試行 action on API failure", async () => {
    mockedApi.listBookings.mockRejectedValue(new Error("boom"));

    renderBookings();

    await waitFor(() => expect(screen.getByText("読み込みに失敗しました")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  test("stats reflect the page slice (best-effort) — upcoming counter increments per future-confirmed row", async () => {
    mockedApi.listBookings.mockResolvedValue(
      pagedResponse([futureBooking(), futureBooking({ id: "b2" })]),
    );

    renderBookings();

    const tiles = await screen.findAllByTestId("stat-card-icon-tile");
    const mintCard = tiles[0]?.parentElement;
    expect(mintCard?.getAttribute("data-tone")).toBe("mint");
    if (mintCard) {
      expect(within(mintCard).getByText("今後の予定")).toBeInTheDocument();
      expect(within(mintCard).getByText("2")).toBeInTheDocument();
    }
  });

  test("typing in search debounces and re-fetches with q=<value>", async () => {
    // ISH-268: search input is debounced (300ms) before hitting the API.
    // The test asserts the last call carries `q` matching the input value.
    mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));

    renderBookings();

    // Initial mount fetch.
    await waitFor(() => expect(mockedApi.listBookings).toHaveBeenCalledTimes(1));
    const firstCall = mockedApi.listBookings.mock.calls[0]?.[0];
    expect(firstCall?.q).toBeUndefined();

    // findBy waits for the toolbar to appear (state.status === "ok"). Using
    // getBy here was racy under coverage instrumentation: the mock-call
    // assertion above resolves the moment the function is invoked, but the
    // resulting Promise.resolve → tanstack-query state update happens in a
    // later microtask, so the toolbar might not be in the DOM yet.
    const searchInput = await screen.findByLabelText("予約を検索");
    fireEvent.change(searchInput, { target: { value: "deep" } });

    // Debounced — wait until the second call materializes.
    await waitFor(
      () => {
        const calls = mockedApi.listBookings.mock.calls;
        const last = calls[calls.length - 1]?.[0];
        expect(last?.q).toBe("deep");
      },
      { timeout: 1500 },
    );
  });

  test("canceled tab triggers a refetch with status=canceled", async () => {
    // ISH-268: tab → server status mapping. The (tab, statusFilter) pair
    // resolves to a server-side status: canceled tab → "canceled"; other
    // tabs always send "confirmed" regardless of statusFilter (the canceled
    // rows live exclusively under the canceled tab). The cleanest assertion
    // is therefore on tab change, where serverStatus actually flips.
    mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));

    renderBookings();

    await waitFor(() => expect(mockedApi.listBookings).toHaveBeenCalled());
    const firstCall = mockedApi.listBookings.mock.calls[0]?.[0];
    expect(firstCall?.status).toBe("confirmed");

    // Switch to the canceled tab (Radix needs mouseDown under happy-dom).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "キャンセル済" }));

    await waitFor(() => {
      const calls = mockedApi.listBookings.mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.status).toBe("canceled");
    });
  });

  test("pagination shows when total > pageSize and next moves to page 2", async () => {
    // First call: page 1 with 25 rows + total 30.
    const page1 = Array.from({ length: 25 }, (_, i) =>
      futureBooking({
        id: `b${i}`,
        linkTitle: `Booking ${i.toString().padStart(2, "0")}`,
        guestName: `Guest ${i}`,
        guestEmail: `g${i}@example.com`,
        startAt: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
        endAt: new Date(Date.now() + (i + 1) * 86_400_000 + 30 * 60_000).toISOString(),
      }),
    );
    const page2 = Array.from({ length: 5 }, (_, i) =>
      futureBooking({
        id: `b${i + 25}`,
        linkTitle: `Booking ${(i + 25).toString().padStart(2, "0")}`,
        guestName: `Guest ${i + 25}`,
        guestEmail: `g${i + 25}@example.com`,
        startAt: new Date(Date.now() + (i + 26) * 86_400_000).toISOString(),
        endAt: new Date(Date.now() + (i + 26) * 86_400_000 + 30 * 60_000).toISOString(),
      }),
    );
    mockedApi.listBookings
      .mockResolvedValueOnce(pagedResponse(page1, { total: 30, page: 1, pageSize: 25 }))
      .mockResolvedValueOnce(pagedResponse(page2, { total: 30, page: 2, pageSize: 25 }));

    renderBookings();

    expect(await screen.findByText("Booking 00")).toBeInTheDocument();
    expect(screen.getByText("Booking 24")).toBeInTheDocument();
    expect(screen.queryByText("Booking 25")).not.toBeInTheDocument();

    expect(screen.getByTestId("bookings-pagination")).toBeInTheDocument();
    expect(screen.getByText("全 30 件中 1–25 件")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));

    await waitFor(() => expect(screen.getByText("Booking 25")).toBeInTheDocument());
    expect(screen.getByText("Booking 29")).toBeInTheDocument();
    expect(screen.queryByText("Booking 00")).not.toBeInTheDocument();
    expect(screen.getByText("全 30 件中 26–30 件")).toBeInTheDocument();
  });

  test("pagination is hidden when total <= pageSize", async () => {
    mockedApi.listBookings.mockResolvedValue(
      pagedResponse(
        Array.from({ length: 5 }, (_, i) =>
          futureBooking({
            id: `b${i}`,
            linkTitle: `Booking ${i}`,
            guestName: `Guest ${i}`,
            guestEmail: `g${i}@example.com`,
            startAt: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
            endAt: new Date(Date.now() + (i + 1) * 86_400_000 + 30 * 60_000).toISOString(),
          }),
        ),
        { total: 5 },
      ),
    );

    renderBookings();

    expect(await screen.findByText("Booking 0")).toBeInTheDocument();
    expect(screen.queryByTestId("bookings-pagination")).not.toBeInTheDocument();
  });

  test("empty state wording differs between no-data and search-miss", async () => {
    // First call: 1 row visible. Second (after typing) returns total=0.
    mockedApi.listBookings
      .mockResolvedValueOnce(
        pagedResponse([futureBooking({ id: "b1", linkTitle: "Alpha", guestName: "Alice" })]),
      )
      .mockResolvedValue(pagedResponse([], { total: 0 }));

    renderBookings();

    // 行は出ている。
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    // 検索ヒット 0 → search-miss empty state。
    fireEvent.change(screen.getByLabelText("予約を検索"), {
      target: { value: "zzznomatch" },
    });
    await waitFor(() => expect(screen.getByTestId("bookings-empty-search")).toBeInTheDocument(), {
      timeout: 1500,
    });
    expect(screen.getByText("該当する予約がありません")).toBeInTheDocument();
    expect(screen.queryByTestId("bookings-empty-no-data")).not.toBeInTheDocument();
  });

  describe("CSV エクスポート — ISH-271", () => {
    // happy-dom does not implement URL.createObjectURL / revokeObjectURL by
    // default. We stub them per-test so the click handler can run end to end.
    let createObjectUrlSpy: ReturnType<typeof vi.fn> | undefined;
    let revokeObjectUrlSpy: ReturnType<typeof vi.fn> | undefined;
    let originalCreate: ((blob: Blob | MediaSource) => string) | undefined;
    let originalRevoke: ((url: string) => void) | undefined;

    beforeEach(() => {
      originalCreate = URL.createObjectURL as ((blob: Blob | MediaSource) => string) | undefined;
      originalRevoke = URL.revokeObjectURL as ((url: string) => void) | undefined;
      createObjectUrlSpy = vi.fn(() => "blob:fake-url");
      revokeObjectUrlSpy = vi.fn();
      // assignments are intentional — happy-dom leaves these unset, and the
      // SUT requires them to drive the download path.
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: createObjectUrlSpy,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revokeObjectUrlSpy,
      });
    });

    afterEach(() => {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreate,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevoke,
      });
    });

    test("clicking the button calls exportBookingsCsv with the current filters and triggers a download", async () => {
      mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));
      const blob = new Blob(["﻿開始日時\r\n"], { type: "text/csv" });
      mockedApi.exportBookingsCsv.mockResolvedValue(blob);

      renderBookings();

      // Wait for the toolbar to render. waitFor on the mock would resolve the
      // moment the function is invoked, before tanstack-query has had a chance
      // to flip state to "ok" — under coverage instrumentation, that race lost
      // often enough to flake. findBy waits for the actual element.
      const searchInput = await screen.findByLabelText("予約を検索");

      // Type a search term so we can assert it propagates to the export call.
      fireEvent.change(searchInput, { target: { value: "alice" } });
      // Wait for the debounce + refetch to settle.
      await waitFor(() => {
        const last =
          mockedApi.listBookings.mock.calls[mockedApi.listBookings.mock.calls.length - 1]?.[0];
        expect(last?.q).toBe("alice");
      });

      const btn = screen.getByRole("button", { name: /CSV エクスポート/ });
      fireEvent.click(btn);

      await waitFor(() => expect(mockedApi.exportBookingsCsv).toHaveBeenCalledTimes(1));
      const args = mockedApi.exportBookingsCsv.mock.calls[0]?.[0];
      expect(args?.q).toBe("alice");
      expect(args?.status).toBe("confirmed");

      // Object URL was created from the returned Blob and revoked again.
      await waitFor(() => expect(createObjectUrlSpy).toHaveBeenCalledWith(blob));
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:fake-url");
    });

    test("button shows loading state and rejects re-clicks while in flight", async () => {
      mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));
      let resolveExport: ((b: Blob) => void) | undefined;
      mockedApi.exportBookingsCsv.mockImplementation(
        () =>
          new Promise<Blob>((resolve) => {
            resolveExport = resolve;
          }),
      );

      renderBookings();

      const btn = await screen.findByRole("button", { name: /CSV エクスポート/ });
      fireEvent.click(btn);
      // Second click while still loading — the SUT short-circuits via the
      // `exporting` ref, so the API is hit exactly once.
      fireEvent.click(btn);

      await waitFor(() => expect(btn).toHaveAttribute("aria-busy", "true"));
      await waitFor(() => expect(btn).toBeDisabled());

      // Resolve so the test doesn't leak a pending promise.
      resolveExport?.(new Blob([""], { type: "text/csv" }));
      await waitFor(() => expect(btn).not.toBeDisabled());
      expect(mockedApi.exportBookingsCsv).toHaveBeenCalledTimes(1);
    });

    test("API failure does not crash the page — the loading state is cleared", async () => {
      mockedApi.listBookings.mockResolvedValue(pagedResponse([futureBooking()]));
      mockedApi.exportBookingsCsv.mockRejectedValue(new Error("boom"));

      renderBookings();

      const btn = await screen.findByRole("button", { name: /CSV エクスポート/ });
      fireEvent.click(btn);

      await waitFor(() => expect(mockedApi.exportBookingsCsv).toHaveBeenCalled());
      // Even though the call rejected, the button comes back to its idle
      // state so the user can retry.
      await waitFor(() => expect(btn).not.toBeDisabled());
    });
  });

  test("loading state renders a centered Spinner instead of plain text", async () => {
    let resolveFn: ((v: ListBookingsResponse) => void) | undefined;
    mockedApi.listBookings.mockImplementation(
      () =>
        new Promise<ListBookingsResponse>((resolve) => {
          resolveFn = resolve;
        }),
    );

    renderBookings();

    // ISH-292: stats と table の双方で Spinner (role=status, aria-label=読み込み中)
    // を中央配置している。getAllByRole で 2 つ検出することを確認する。
    const statuses = screen.getAllByRole("status", { name: "読み込み中" });
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    // Table skeleton (placeholder) は data-testid を維持。
    expect(screen.getByTestId("bookings-table-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument();

    // Resolve so the test doesn't leak a pending promise.
    resolveFn?.(pagedResponse([], { total: 0 }));
    await waitFor(() => expect(screen.getByText("予約はまだありません")).toBeInTheDocument());
  });
});
