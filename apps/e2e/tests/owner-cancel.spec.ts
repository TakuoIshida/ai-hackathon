import { expect, test } from "@playwright/test";

// Scenario 4 of ISH-139:
//   Owner cancels a booking from the dashboard. After confirming the
//   browser confirm() prompt, the booking detail page reloads with status
//   "キャンセル済".
//
// As with the other dashboard specs, Clerk is bypassed via the Vite alias
// (apps/web/src/test/clerk-e2e-shim.tsx) and all API responses are mocked.

test.describe("owner-side booking cancel", () => {
  test("owner cancels from /confirmed-list/:id and the detail flips to canceled", async ({
    page,
  }) => {
    const BOOKING_ID = "bk-owner-cancel-1";
    const startAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3).toISOString(); // 3 days out
    const endAt = new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString();

    type Booking = {
      id: string;
      linkId: string;
      linkSlug: string;
      linkTitle: string;
      // ISH-267: BookingSummary now carries host info; mock fixture mirrors
      // the BE response shape so the FE doesn't crash on missing fields.
      hostUserId: string;
      hostName: string;
      hostEmail: string;
      startAt: string;
      endAt: string;
      guestName: string;
      guestEmail: string;
      status: "confirmed" | "canceled";
      meetUrl: string | null;
      // ISH-269: BE response now includes Google Calendar event id +
      // htmlLink so the detail page can deeplink to the real event.
      googleEventId: string | null;
      googleHtmlLink: string | null;
      canceledAt: string | null;
      createdAt: string;
    };
    let booking: Booking = {
      id: BOOKING_ID,
      linkId: "link-1",
      linkSlug: "intro-30min",
      linkTitle: "Intro 30 min",
      hostUserId: "u-host-1",
      hostName: "Host McHostface",
      hostEmail: "host@example.com",
      startAt,
      endAt,
      guestName: "Guest McGuestface",
      guestEmail: "guest@example.com",
      status: "confirmed",
      meetUrl: "https://meet.google.com/zzz-yyyy-xxx",
      googleEventId: "evt-google-zzz",
      googleHtmlLink: "https://www.google.com/calendar/event?eid=evt-google-zzz",
      canceledAt: null,
      createdAt: new Date().toISOString(),
    };

    // ISH-254: BookingDetail now calls GET /bookings/:id directly (was list+filter).
    // Two route handlers — Playwright matches in REVERSE registration order, so
    // the narrower `**/bookings/*` (registered second) is checked first when both
    // could match. The list endpoint is kept for any incidental callers.
    await page.route("**/bookings", async (route, req) => {
      if (req.method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ bookings: [booking] }),
      });
    });
    await page.route("**/bookings/*", async (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ booking }),
        });
      }
      if (req.method() === "DELETE") {
        booking = {
          ...booking,
          status: "canceled",
          canceledAt: new Date().toISOString(),
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
      return route.fallback();
    });

    // The browser confirm() must auto-accept so we don't hang waiting for a
    // user click. dialog handlers persist for the rest of the page lifetime.
    page.on("dialog", (dialog) => {
      void dialog.accept();
    });

    // Visit the detail page directly. With the auth bypass, the dashboard
    // layout renders without redirecting through Clerk.
    await page.goto(`/confirmed-list/${BOOKING_ID}`);

    // Wait for the detail card to materialize. The list-and-filter pattern
    // means the booking title appears AFTER GET /bookings resolves.
    await expect(page.getByRole("heading", { name: "Intro 30 min" })).toBeVisible({
      timeout: 10_000,
    });
    // ISH-248: status moved from "ステータス: X" text into a Badge next to H1.
    // Badge text alone matches; "確定" is unique on this page (banner uses "キャンセル済 · ..." instead).
    await expect(page.getByText("確定", { exact: true })).toBeVisible();

    // Cancel button — only visible while the booking is future + confirmed.
    const cancelBtn = page.getByRole("button", { name: "予約をキャンセル" });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // After DELETE → reload. Badge flips to "キャンセル済"; banner also shows
    // "キャンセル済 · {date}"; either is fine for the visibility assertion.
    await expect(page.getByText("キャンセル済", { exact: true })).toBeVisible();
    // The cancel button is gone now that the booking is canceled.
    await expect(page.getByRole("button", { name: "予約をキャンセル" })).toBeHidden();
  });
});
