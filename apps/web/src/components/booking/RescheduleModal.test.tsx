import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { httpFetch } from "@/lib/http";
import { RescheduleModal } from "./RescheduleModal";

/**
 * Vitest harness for the reschedule slot picker (ISH-270).
 *
 * The modal shells out to `fetchPublicSlots` for the slot grid, which is just
 * a thin wrapper around `httpFetch`. The test setup file mocks `httpFetch`
 * globally, so each test only needs to script its responses.
 */

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Slot = { start: string; end: string };

function slotsResponse(slots: Slot[]): Response {
  return jsonResponse({ durationMinutes: 30, timeZone: "Asia/Tokyo", slots });
}

afterEach(() => {
  vi.mocked(httpFetch).mockReset();
});

function Harness({
  onConfirm = vi.fn(async () => {}),
  initialOpen = true,
}: {
  onConfirm?: (input: { startAt: string; endAt: string }) => Promise<void>;
  initialOpen?: boolean;
} = {}) {
  const [open, setOpen] = React.useState(initialOpen);
  return (
    <RescheduleModal
      open={open}
      onOpenChange={setOpen}
      linkSlug="intro-30"
      currentStartAt="2026-12-14T05:00:00.000Z"
      currentEndAt="2026-12-14T05:30:00.000Z"
      onConfirm={onConfirm}
      timeZone="Asia/Tokyo"
    />
  );
}

describe("<RescheduleModal />", () => {
  test("fetches slots on open and renders the title + current-slot summary", async () => {
    vi.mocked(httpFetch).mockResolvedValue(slotsResponse([]));

    render(<Harness />);

    expect(
      await screen.findByRole("heading", { name: "予約をリスケジュール" }),
    ).toBeInTheDocument();
    // Description carries the current slot label so the user can compare.
    expect(screen.getByText(/現在の予定:/)).toBeInTheDocument();
    // The slot fetch fired with the expected URL shape.
    await waitFor(() => expect(httpFetch).toHaveBeenCalled());
    const [calledUrl] = vi.mocked(httpFetch).mock.calls[0] ?? [];
    expect(String(calledUrl)).toContain("/public/links/intro-30/slots");
  });

  test("confirm button is disabled until a slot is selected", async () => {
    // Pre-populate slots so a date in the visible month is clickable. We pin
    // them to the current visible month based on Date.now() to avoid flakiness.
    const now = new Date();
    const visibleYear = now.getFullYear();
    const visibleMonth = now.getMonth();
    // Pick the 15th of the visible month — almost always inside the grid.
    const slotStart = new Date(Date.UTC(visibleYear, visibleMonth, 15, 1, 0, 0));
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    vi.mocked(httpFetch).mockResolvedValue(
      slotsResponse([{ start: slotStart.toISOString(), end: slotEnd.toISOString() }]),
    );

    render(<Harness />);

    await waitFor(() => expect(httpFetch).toHaveBeenCalled());
    const confirmBtn = await screen.findByRole("button", { name: "リスケを確定" });
    expect(confirmBtn).toBeDisabled();
  });

  test("selecting a date + slot enables confirm and forwards the ISO pair to onConfirm", async () => {
    const now = new Date();
    const slotStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 15, 1, 0, 0));
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    vi.mocked(httpFetch).mockResolvedValue(
      slotsResponse([{ start: slotStart.toISOString(), end: slotEnd.toISOString() }]),
    );

    const onConfirm = vi.fn(async () => {});
    render(<Harness onConfirm={onConfirm} />);

    await waitFor(() => expect(httpFetch).toHaveBeenCalled());

    // Click the date button (button label = day-of-month "15").
    const dayBtn = await screen.findByRole("button", { name: "15" });
    fireEvent.click(dayBtn);

    // The right-side panel renders the slot button labelled by HH:mm – HH:mm.
    const slotBtns = await screen.findAllByRole("button");
    const slotBtn = slotBtns.find((b) => b.textContent?.includes("–"));
    expect(slotBtn).toBeDefined();
    if (!slotBtn) throw new Error("slot button not found");
    fireEvent.click(slotBtn);

    const confirm = screen.getByRole("button", { name: "リスケを確定" });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith({
      startAt: slotStart.toISOString(),
      endAt: slotEnd.toISOString(),
    });
  });

  test("surfaces the onConfirm error message inline (does not auto-close on failure)", async () => {
    const now = new Date();
    const slotStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 15, 1, 0, 0));
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);
    vi.mocked(httpFetch).mockResolvedValue(
      slotsResponse([{ start: slotStart.toISOString(), end: slotEnd.toISOString() }]),
    );

    const onConfirm = vi.fn(async () => {
      throw new Error("この時間枠は既に予約されています。別の時間を選んでください。");
    });
    render(<Harness onConfirm={onConfirm} />);

    await waitFor(() => expect(httpFetch).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "15" }));
    const slotBtns = await screen.findAllByRole("button");
    const slotBtn = slotBtns.find((b) => b.textContent?.includes("–"));
    if (!slotBtn) throw new Error("slot not found");
    fireEvent.click(slotBtn);
    fireEvent.click(screen.getByRole("button", { name: "リスケを確定" }));

    expect(
      await screen.findByText("この時間枠は既に予約されています。別の時間を選んでください。"),
    ).toBeInTheDocument();
  });
});
