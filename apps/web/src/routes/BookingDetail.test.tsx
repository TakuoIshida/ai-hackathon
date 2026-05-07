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
      // ISH-270: BookingDetail now triggers reschedule via api.rescheduleBooking
      // when the user picks a slot in the modal. Tests don't drive the modal
      // end-to-end (that's covered in RescheduleModal.test.tsx + the e2e spec)
      // so the mock is enough to satisfy the import surface.
      rescheduleBooking: vi.fn(),
    },
  };
});

// ISH-270: BookingDetail wraps reschedule confirmation with `useToast()`.
// The test render mounts a real ToastProvider so the hook resolves.
vi.mock("@/components/booking/RescheduleModal", () => ({
  // The modal is exercised in its own sidecar test; replace with a stub here
  // so BookingDetail tests focus on button wiring + state transitions.
  RescheduleModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="reschedule-modal-stub" /> : null,
}));

import { ToastProvider } from "@/components/ui/toast";
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
    hostUserId: "u-host-1",
    hostName: "Hana Host",
    hostEmail: "hana@example.com",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    guestName: "Alice",
    guestEmail: "alice@example.com",
    status: "confirmed",
    meetUrl: "https://meet.google.com/abc-defg-hij",
    googleEventId: "evt-google-abc",
    googleHtmlLink: "https://www.google.com/calendar/event?eid=evt-google-abc",
    canceledAt: null,
    createdAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function renderAt(id: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/confirmed-list/${id}`]}>
        <Routes>
          <Route path="/confirmed-list/:id" element={<BookingDetail />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
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

    // 2. 主催者 — ISH-267: BE が返す hostName / hostEmail を render する。
    expect(screen.getByRole("heading", { level: 2, name: /主催者/ })).toBeInTheDocument();
    expect(screen.getByText("Hana Host")).toBeInTheDocument();
    expect(screen.getByText("hana@example.com")).toBeInTheDocument();

    // 3. 参加者 — guest + メール link
    expect(screen.getByRole("heading", { level: 2, name: /参加者/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /メールでメッセージ/ })).toHaveAttribute(
      "href",
      "mailto:alice@example.com",
    );

    // 4. 会議情報
    expect(screen.getByRole("heading", { level: 2, name: /会議情報/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meet を開く" })).toBeInTheDocument();
    // ISH-269: 「Google Calendar で開く」 must point at the real event htmlLink
    // returned by events.insert — NOT the old best-effort eventedit URL.
    expect(screen.getByRole("link", { name: /Google Calendar で開く/ })).toHaveAttribute(
      "href",
      "https://www.google.com/calendar/event?eid=evt-google-abc",
    );

    // 5. アクション Footer — ISH-270: リスケ button is now enabled and opens
    // the slot-picker modal. Cancel stays active.
    expect(screen.getByRole("button", { name: "リスケ" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "予約をキャンセル" })).toBeEnabled();
  });

  test("ISH-270: clicking リスケ opens the RescheduleModal", async () => {
    mockedApi.getBooking.mockResolvedValue({ booking: futureBooking({ id: "b1" }) });

    renderAt("b1");

    const rescheduleBtn = await screen.findByRole("button", { name: "リスケ" });
    expect(screen.queryByTestId("reschedule-modal-stub")).toBeNull();
    fireEvent.click(rescheduleBtn);
    expect(screen.getByTestId("reschedule-modal-stub")).toBeInTheDocument();
  });

  test("ISH-269: hides 「Google Calendar で開く」 button when googleHtmlLink is null", async () => {
    // Google sync skipped or failed at confirm time → no real event deeplink
    // to offer. We hide the button rather than fall back to a new-event-create
    // URL so the user isn't sent to the wrong place.
    mockedApi.getBooking.mockResolvedValue({
      booking: futureBooking({ id: "b1", googleHtmlLink: null }),
    });

    renderAt("b1");

    // Meet button still rendered as long as meetUrl is set.
    expect(await screen.findByRole("link", { name: "Meet を開く" })).toBeInTheDocument();
    // Calendar deeplink button is gone.
    expect(screen.queryByRole("link", { name: /Google Calendar で開く/ })).toBeNull();
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
