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
      startAt: string;
      endAt: string;
      guestName: string;
      guestEmail: string;
      status: "confirmed" | "canceled";
      meetUrl: string | null;
      canceledAt: string | null;
      createdAt: string;
    };
    let booking: Booking = {
      id: BOOKING_ID,
      linkId: "link-1",
      linkSlug: "intro-30min",
      linkTitle: "Intro 30 min",
      startAt,
      endAt,
      guestName: "Guest McGuestface",
      guestEmail: "guest@example.com",
      status: "confirmed",
      meetUrl: "https://meet.google.com/zzz-yyyy-xxx",
      canceledAt: null,
      createdAt: new Date().toISOString(),
    };

    // Two handlers. Playwright matches routes in REVERSE registration order,
    // so the narrower DELETE handler (registered second) is checked first
    // when both could match a `/bookings/:id` URL. We use globs because
    // they are stable across Playwright versions and easy to read.
    await page.route("**/bookings", async (route, req) => {
      if (req.method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ bookings: [booking] }),
      });
    });
    await page.route("**/bookings/*", async (route, req) => {
      if (req.method() !== "DELETE") return route.fallback();
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
    await expect(page.getByText("ステータス: 確定")).toBeVisible();

    // Cancel button — only visible while the booking is future + confirmed.
    const cancelBtn = page.getByRole("button", { name: "予約をキャンセル" });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // After DELETE → reload (the page calls list again). The status flips.
    await expect(page.getByText("ステータス: キャンセル済")).toBeVisible();
    // The cancel button is gone now that the booking is canceled.
    await expect(page.getByRole("button", { name: "予約をキャンセル" })).toBeHidden();
  });
});
