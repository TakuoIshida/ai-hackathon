import { expect, test } from "@playwright/test";

// ISH-270 golden path: owner reschedules a booking from /confirmed-list/:id.
//   - Detail page loads with the original slot.
//   - Owner clicks リスケ to open the modal.
//   - Owner picks a different slot from the calendar grid.
//   - Owner clicks 「リスケを確定」 → POST /bookings/:id/reschedule fires.
//   - Detail re-fetches and renders the new start/end.
//
// Mirrors `owner-cancel.spec.ts`: Clerk is bypassed via the Vite alias
// (apps/web/src/test/clerk-e2e-shim.tsx) and every API call is mocked.
// Google API is not exercised here — the BE does best-effort patch which the
// route mock doesn't simulate.

// The slot picker renders times in the browser TZ (defaults to
// `Intl.DateTimeFormat().resolvedOptions().timeZone`). Pin the chromium
// context to Asia/Tokyo so the slot button text matches /15:00.*15:30/
// regardless of the runner's wall-clock TZ (CI runs in UTC).
test.use({ timezoneId: "Asia/Tokyo" });

test.describe("owner-side booking reschedule", () => {
  test("owner picks a new slot and the detail flips to the new time", async ({ page }) => {
    const BOOKING_ID = "bk-owner-reschedule-1";
    const LINK_SLUG = "intro-30min";

    // Anchor "now" so date math in the modal grid matches the mock slots.
    // Pick a far-future Monday so the slot is always in the future.
    const ORIGINAL_START = "2026-12-14T05:00:00.000Z"; // Mon 14:00 JST
    const ORIGINAL_END = "2026-12-14T05:30:00.000Z";
    const NEW_START = "2026-12-14T06:00:00.000Z"; // Mon 15:00 JST
    const NEW_END = "2026-12-14T06:30:00.000Z";

    type Booking = {
      id: string;
      linkId: string;
      linkSlug: string;
      linkTitle: string;
      hostUserId: string;
      hostName: string;
      hostEmail: string;
      startAt: string;
      endAt: string;
      guestName: string;
      guestEmail: string;
      status: "confirmed" | "canceled";
      meetUrl: string | null;
      googleEventId: string | null;
      googleHtmlLink: string | null;
      canceledAt: string | null;
      createdAt: string;
    };
    let booking: Booking = {
      id: BOOKING_ID,
      linkId: "link-1",
      linkSlug: LINK_SLUG,
      linkTitle: "Intro 30 min",
      hostUserId: "u-host-1",
      hostName: "Host McHostface",
      hostEmail: "host@example.com",
      startAt: ORIGINAL_START,
      endAt: ORIGINAL_END,
      guestName: "Guest McGuestface",
      guestEmail: "guest@example.com",
      status: "confirmed",
      meetUrl: "https://meet.google.com/zzz-yyyy-xxx",
      googleEventId: "evt-google-zzz",
      googleHtmlLink: "https://www.google.com/calendar/event?eid=evt-google-zzz",
      canceledAt: null,
      createdAt: new Date().toISOString(),
    };

    // BookingDetail's GET path: list + detail glob (mirrors owner-cancel).
    await page.route("**/bookings*", async (route, req) => {
      if (req.method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ bookings: [booking], total: 1, page: 1, pageSize: 25 }),
      });
    });

    // Detail GET + reschedule POST. Match `**/bookings/*/reschedule` BEFORE
    // the generic `**/bookings/*` so POST hits this handler.
    await page.route("**/bookings/*/reschedule", async (route, req) => {
      if (req.method() === "POST") {
        const body = req.postDataJSON() as { startAt: string; endAt: string };
        booking = {
          ...booking,
          startAt: body.startAt,
          endAt: body.endAt,
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ booking }),
        });
      }
      return route.fallback();
    });

    await page.route("**/bookings/*", async (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ booking }),
        });
      }
      return route.fallback();
    });

    // Public slots endpoint feeds the modal grid.
    await page.route("**/public/links/intro-30min/slots*", async (route) => {
      // Three sample slots on 2026-12-14 (the same day as the original booking).
      // Including 06:00 UTC = 15:00 JST as the target NEW slot.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
          slots: [
            { start: "2026-12-14T05:00:00.000Z", end: "2026-12-14T05:30:00.000Z" },
            { start: NEW_START, end: NEW_END },
            { start: "2026-12-14T07:00:00.000Z", end: "2026-12-14T07:30:00.000Z" },
          ],
        }),
      });
    });

    // Visit the detail page directly. With the auth bypass, the dashboard
    // layout renders without redirecting through Clerk.
    await page.goto(`/confirmed-list/${BOOKING_ID}`);

    await expect(page.getByRole("heading", { name: "Intro 30 min" })).toBeVisible({
      timeout: 10_000,
    });

    // Click リスケ to open the modal.
    const rescheduleBtn = page.getByRole("button", { name: "リスケ", exact: true });
    await expect(rescheduleBtn).toBeEnabled();
    await rescheduleBtn.click();

    // Modal title appears.
    await expect(page.getByRole("heading", { name: "予約をリスケジュール" })).toBeVisible();

    // Navigate the modal calendar to 2026-12 (assumes "today" is well before
    // that date). The "›" chevron advances one month at a time. Loop until
    // the title reads 2026年12月.
    const monthLabel = page.locator("text=/\\d{4}年\\d{1,2}月/").first();
    for (let i = 0; i < 240; i++) {
      const txt = (await monthLabel.textContent()) ?? "";
      if (txt.startsWith("2026年12月")) break;
      await page.getByRole("button", { name: "›" }).click();
    }
    await expect(monthLabel).toContainText("2026年12月");

    // Click day 14 in the visible month.
    await page.getByRole("button", { name: "14", exact: true }).click();

    // Slot list shows 3 buttons; pick the 15:00 – 15:30 (= NEW slot).
    await page.getByRole("button", { name: /15:00.*15:30/ }).click();

    // Confirm.
    const confirmBtn = page.getByRole("button", { name: "リスケを確定" });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // After confirm the modal closes and the detail reloads with the new slot.
    // The page header AND the 基本情報 row both render the localized time; either
    // is fine for the assertion, so we just assert at least one match exists.
    await expect(page.getByText(/15:00.*15:30/).first()).toBeVisible({ timeout: 5_000 });
    // Ensure the modal is gone.
    await expect(page.getByRole("heading", { name: "予約をリスケジュール" })).toBeHidden();
  });
});
