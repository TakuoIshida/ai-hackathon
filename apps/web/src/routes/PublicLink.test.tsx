import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConfirmedBooking, PublicLink as PublicLinkData, PublicSlot } from "@/lib/public-api";

vi.mock("@/lib/public-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-api")>();
  return {
    ...actual,
    fetchPublicLink: vi.fn(),
    fetchPublicSlots: vi.fn(),
    postPublicBooking: vi.fn(),
  };
});

import { fetchPublicLink, fetchPublicSlots, postPublicBooking } from "@/lib/public-api";
import PublicLink from "./PublicLink";

const mockedFetchPublicLink = vi.mocked(fetchPublicLink);
const mockedFetchPublicSlots = vi.mocked(fetchPublicSlots);
const mockedPostPublicBooking = vi.mocked(postPublicBooking);

const link: PublicLinkData = {
  slug: "intro-30",
  title: "30 minute intro",
  description: "Test description",
  durationMinutes: 30,
  timeZone: "Asia/Tokyo",
};

// Build a slot anchored to a specific UTC date in the visible month so the
// calendar grid (UTC-built) and the slotsByDate (JST-formatted) line up on
// the same `YYYY-MM-DD` key. UTC 10:00 = JST 19:00 same day.
function makeSlot(): { slot: PublicSlot; expectedDayLabel: string } {
  const today = new Date();
  // Pick a date safely in the current month. Day 15 avoids month boundaries.
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth(); // 0-indexed for Date.UTC
  const day = 15;
  const startMs = Date.UTC(year, month, day, 10, 0, 0);
  const start = new Date(startMs);
  const end = new Date(startMs + 30 * 60_000);
  return {
    slot: { start: start.toISOString(), end: end.toISOString() },
    expectedDayLabel: String(day),
  };
}

function renderAt(slug: string) {
  return render(
    <MemoryRouter initialEntries={[`/${slug}`]}>
      <Routes>
        <Route path="/:slug" element={<PublicLink />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<PublicLink />", () => {
  test("with no slot selected, the confirm submit button is not present (i.e. inactive)", async () => {
    mockedFetchPublicLink.mockResolvedValue(link);
    mockedFetchPublicSlots.mockResolvedValue({
      durationMinutes: 30,
      timeZone: "Asia/Tokyo",
      slots: [makeSlot().slot],
    });

    renderAt("intro-30");

    expect(
      await screen.findByRole("heading", { level: 1, name: "30 minute intro" }),
    ).toBeInTheDocument();
    // No selection has been made yet, so the form-step submit doesn't exist.
    expect(screen.queryByRole("button", { name: "予約を確定" })).toBeNull();
  });

  test("selecting a slot moves to the form, and submitting confirms the booking", async () => {
    const { slot, expectedDayLabel } = makeSlot();
    mockedFetchPublicLink.mockResolvedValue(link);
    mockedFetchPublicSlots.mockResolvedValue({
      durationMinutes: 30,
      timeZone: "Asia/Tokyo",
      slots: [slot],
    });
    const confirmed: ConfirmedBooking = {
      id: "b1",
      startAt: slot.start,
      endAt: slot.end,
      guestName: "Alice",
      guestEmail: "alice@example.com",
      status: "confirmed",
      meetUrl: "https://meet.google.com/x",
      cancellationToken: "tok",
    };
    mockedPostPublicBooking.mockResolvedValue(confirmed);

    renderAt("intro-30");

    // Title eventually shows once the link metadata loads.
    expect(
      await screen.findByRole("heading", { level: 1, name: "30 minute intro" }),
    ).toBeInTheDocument();

    // Wait for the slots fetch to settle, then click the calendar day cell so
    // the slot list for that day renders. Multiple cells may share a day label
    // (prev/next month), so pick the one that became enabled (i.e. has slots).
    const dayCell = await waitFor(() => {
      const candidates = screen
        .getAllByRole("button")
        .filter((b) => b.textContent === expectedDayLabel);
      const enabled = candidates.find((b) => !(b as HTMLButtonElement).disabled);
      if (!enabled) throw new Error("calendar cell not yet enabled");
      return enabled;
    });
    fireEvent.click(dayCell);

    // Slot button shows up after the date is selected.
    const slotButton = await waitFor(() => {
      const buttons = screen.getAllByRole("button");
      const found = buttons.find((b) => /\d{2}:\d{2}\s*–\s*\d{2}:\d{2}/.test(b.textContent ?? ""));
      if (!found) throw new Error("slot button not yet rendered");
      return found;
    });

    fireEvent.click(slotButton);

    // Now in the form step; the confirm button is enabled.
    const confirmButton = await screen.findByRole("button", { name: "予約を確定" });
    expect(confirmButton).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText("お名前"), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: "alice@example.com" },
    });

    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockedPostPublicBooking).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("予約が確定しました")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://meet.google.com/x" })).toBeInTheDocument();
  });

  test("renders the not-found state when the link doesn't resolve", async () => {
    const { PublicApiError } = await import("@/lib/public-api");
    mockedFetchPublicLink.mockRejectedValue(new PublicApiError(404, "not_found"));
    mockedFetchPublicSlots.mockResolvedValue({
      durationMinutes: 30,
      timeZone: "Asia/Tokyo",
      slots: [],
    });

    renderAt("missing");

    expect(await screen.findByText("リンクが見つかりません")).toBeInTheDocument();
  });
});
