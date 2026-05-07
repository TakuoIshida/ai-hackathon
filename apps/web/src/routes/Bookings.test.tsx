import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function pastBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  const start = new Date(Date.now() - 7 * 86_400_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    id: "p1",
    linkId: "l1",
    linkSlug: "intro-30",
    linkTitle: "Past meeting",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    guestName: "Charlie",
    guestEmail: "charlie@example.com",
    status: "confirmed",
    meetUrl: null,
    canceledAt: null,
    createdAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
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
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    guestName: "Dana",
    guestEmail: "dana@example.com",
    status: "canceled",
    meetUrl: null,
    canceledAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("<Bookings />", () => {
  test("renders the page header (H1 + sub + CSV エクスポート button)", async () => {
    mockedApi.listBookings.mockResolvedValue({ bookings: [futureBooking()] });

    renderBookings();

    expect(
      await screen.findByRole("heading", { name: "確定済の予定", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("確定した予約を一覧で確認できます")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CSV エクスポート/ })).toBeDisabled();
  });

  test("renders 3 stat cards with mint / blue / rose tones", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [
        futureBooking(),
        futureBooking({ id: "b2", linkTitle: "Deep dive", guestName: "Bob" }),
        canceledBooking(),
      ],
    });

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
    mockedApi.listBookings.mockResolvedValue({ bookings: [futureBooking()] });

    renderBookings();

    const upcoming = await screen.findByRole("tab", { name: "今後の予定" });
    const past = screen.getByRole("tab", { name: "過去" });
    const canceled = screen.getByRole("tab", { name: "キャンセル済" });
    expect(upcoming).toHaveAttribute("data-state", "active");
    expect(past).toHaveAttribute("data-state", "inactive");
    expect(canceled).toHaveAttribute("data-state", "inactive");
  });

  test("renders the table with 5 columns + an action column on rows", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [
        futureBooking(),
        futureBooking({ id: "b2", linkTitle: "Deep dive", guestName: "Bob" }),
      ],
    });

    renderBookings();

    // Wait for at least one row to render before checking column headers —
    // the header text appears in both the loading skeleton and the populated
    // table, so anchoring on a row title removes the race.
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

  test("switching tabs filters the rows (upcoming → past → canceled)", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [futureBooking(), pastBooking(), canceledBooking()],
    });

    renderBookings();

    // Default: upcoming → only the future booking is visible.
    expect(await screen.findByText("30 minute intro")).toBeInTheDocument();
    expect(screen.queryByText("Past meeting")).not.toBeInTheDocument();
    expect(screen.queryByText("Canceled meeting")).not.toBeInTheDocument();

    // 過去 tab — Radix Tabs uses pointer events; happy-dom doesn't fire
    // pointerDown from a synthetic click(), so use mouseDown directly.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "過去" }));
    await waitFor(() => expect(screen.getByText("Past meeting")).toBeInTheDocument());
    expect(screen.queryByText("30 minute intro")).not.toBeInTheDocument();
    expect(screen.queryByText("Canceled meeting")).not.toBeInTheDocument();

    // キャンセル済 tab
    fireEvent.mouseDown(screen.getByRole("tab", { name: "キャンセル済" }));
    await waitFor(() => expect(screen.getByText("Canceled meeting")).toBeInTheDocument());
    expect(screen.queryByText("30 minute intro")).not.toBeInTheDocument();
    expect(screen.queryByText("Past meeting")).not.toBeInTheDocument();
    expect(screen.getByText("キャンセル済", { selector: "span" })).toBeInTheDocument();
  });

  test("shows the empty state when no bookings match the active tab", async () => {
    mockedApi.listBookings.mockResolvedValue({ bookings: [] });

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

  test("filters stats by status: 今後の予定 counts only future confirmed", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [futureBooking(), futureBooking({ id: "b2" }), pastBooking(), canceledBooking()],
    });

    renderBookings();

    // The mint-toned StatCard is the 今後の予定 counter (3 stat cards in
    // mint/blue/rose order). Within it the value should be 2 (only future +
    // confirmed bookings count).
    const tiles = await screen.findAllByTestId("stat-card-icon-tile");
    const mintCard = tiles[0]?.parentElement;
    expect(mintCard?.getAttribute("data-tone")).toBe("mint");
    if (mintCard) {
      expect(within(mintCard).getByText("今後の予定")).toBeInTheDocument();
      expect(within(mintCard).getByText("2")).toBeInTheDocument();
    }
  });

  test("toolbar search filters rows by guest name / email / link title", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [
        futureBooking({ id: "b1", linkTitle: "30 minute intro", guestName: "Alice" }),
        futureBooking({
          id: "b2",
          linkTitle: "Deep dive session",
          guestName: "Bob",
          guestEmail: "bob@example.com",
        }),
        futureBooking({
          id: "b3",
          linkTitle: "Quick chat",
          guestName: "Charlie",
          guestEmail: "charlie@example.com",
        }),
      ],
    });

    renderBookings();

    expect(await screen.findByText("30 minute intro")).toBeInTheDocument();
    const input = screen.getByLabelText("予約を検索");
    fireEvent.change(input, { target: { value: "deep" } });
    await waitFor(() => expect(screen.getByText("Deep dive session")).toBeInTheDocument());
    expect(screen.queryByText("30 minute intro")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick chat")).not.toBeInTheDocument();

    // メール部分一致
    fireEvent.change(input, { target: { value: "charlie@" } });
    await waitFor(() => expect(screen.getByText("Quick chat")).toBeInTheDocument());
    expect(screen.queryByText("Deep dive session")).not.toBeInTheDocument();
  });

  test("status filter narrows rows to canceled-only when 「キャンセル済」 is picked", async () => {
    // Mix of confirmed + canceled rows on the canceled tab is impossible
    // (the tab itself filters by canceled), so the cleanest assertion is:
    // upcoming tab + status filter = canceled → 0 rows → search-miss empty
    // state. (Settings.tsx uses the same fireEvent.click pattern on Radix
    // Select trigger + option.)
    mockedApi.listBookings.mockResolvedValue({
      bookings: [
        futureBooking({ id: "b1", linkTitle: "Confirmed A", guestName: "Alice" }),
        futureBooking({ id: "b2", linkTitle: "Confirmed B", guestName: "Bob" }),
      ],
    });

    renderBookings();

    expect(await screen.findByText("Confirmed A")).toBeInTheDocument();

    // Click the status filter trigger and pick 「キャンセル済」.
    const trigger = screen.getByLabelText("ステータスで絞り込み");
    fireEvent.click(trigger);
    const canceledOption = await screen.findByRole("option", { name: /^キャンセル済$/ });
    fireEvent.click(canceledOption);

    // Upcoming tab has no canceled rows → search-miss empty state.
    await waitFor(() => expect(screen.getByTestId("bookings-empty-search")).toBeInTheDocument());
    expect(screen.queryByText("Confirmed A")).not.toBeInTheDocument();
  });

  test("pagination shows controls when rows > 25 and next moves to page 2", async () => {
    const many: BookingSummary[] = Array.from({ length: 30 }, (_, i) => {
      const start = new Date(Date.now() + (i + 1) * 86_400_000);
      const end = new Date(start.getTime() + 30 * 60_000);
      return {
        id: `b${i}`,
        linkId: "l1",
        linkSlug: "intro",
        linkTitle: `Booking ${i.toString().padStart(2, "0")}`,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        guestName: `Guest ${i}`,
        guestEmail: `g${i}@example.com`,
        status: "confirmed" as const,
        meetUrl: null,
        canceledAt: null,
        createdAt: new Date().toISOString(),
      };
    });
    mockedApi.listBookings.mockResolvedValue({ bookings: many });

    renderBookings();

    // First page: rows 00..24 visible, row 25 not yet.
    expect(await screen.findByText("Booking 00")).toBeInTheDocument();
    expect(screen.getByText("Booking 24")).toBeInTheDocument();
    expect(screen.queryByText("Booking 25")).not.toBeInTheDocument();

    // Pagination controls visible.
    expect(screen.getByTestId("bookings-pagination")).toBeInTheDocument();
    expect(screen.getByText("全 30 件中 1–25 件")).toBeInTheDocument();

    const next = screen.getByRole("button", { name: "次のページ" });
    fireEvent.click(next);

    await waitFor(() => expect(screen.getByText("Booking 25")).toBeInTheDocument());
    expect(screen.getByText("Booking 29")).toBeInTheDocument();
    expect(screen.queryByText("Booking 00")).not.toBeInTheDocument();
    expect(screen.getByText("全 30 件中 26–30 件")).toBeInTheDocument();
  });

  test("pagination is hidden when rows <= 25", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: Array.from({ length: 5 }, (_, i) =>
        futureBooking({
          id: `b${i}`,
          linkTitle: `Booking ${i}`,
          guestName: `Guest ${i}`,
          guestEmail: `g${i}@example.com`,
          startAt: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
          endAt: new Date(Date.now() + (i + 1) * 86_400_000 + 30 * 60_000).toISOString(),
        }),
      ),
    });

    renderBookings();

    expect(await screen.findByText("Booking 0")).toBeInTheDocument();
    expect(screen.queryByTestId("bookings-pagination")).not.toBeInTheDocument();
  });

  test("empty state wording differs between no-data and search-miss", async () => {
    mockedApi.listBookings.mockResolvedValue({
      bookings: [futureBooking({ id: "b1", linkTitle: "Alpha", guestName: "Alice" })],
    });

    renderBookings();

    // 行は出ている。
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    // 検索ヒット 0 → search-miss empty state。
    fireEvent.change(screen.getByLabelText("予約を検索"), {
      target: { value: "zzznomatch" },
    });
    await waitFor(() => expect(screen.getByTestId("bookings-empty-search")).toBeInTheDocument());
    expect(screen.getByText("該当する予約がありません")).toBeInTheDocument();
    expect(screen.queryByTestId("bookings-empty-no-data")).not.toBeInTheDocument();
  });

  test("loading state renders a skeleton (role=status) instead of plain text", async () => {
    let resolveFn: ((v: { bookings: BookingSummary[] }) => void) | undefined;
    mockedApi.listBookings.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    renderBookings();

    // Stats skeleton — role=status with aria-label
    expect(screen.getByRole("status", { name: "読み込み中" })).toBeInTheDocument();
    // Table skeleton (placeholder) replaces the previous "読み込み中..." text.
    expect(screen.getByTestId("bookings-table-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument();

    // Resolve so the test doesn't leak a pending promise.
    resolveFn?.({ bookings: [] });
    await waitFor(() => expect(screen.getByText("予約はまだありません")).toBeInTheDocument());
  });
});
