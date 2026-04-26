import { expect, test } from "@playwright/test";

// Scenario 3 of ISH-139:
//   A guest opens a published public link, picks a day + slot, fills the
//   booking form, and sees the confirmation card.
//
// All API endpoints are stubbed at the page-route layer.
// Google Calendar / Meet / Resend email are NEVER called — this is a pure
// front-end flow test driven by mocked /public/* responses.

test.describe("public booking flow", () => {
  test("guest books an available slot and sees the confirmation", async ({ page }) => {
    const SLUG = "intro-30min-public";
    const TITLE = "30 min meeting";

    // Seed slot 3 days out so it's always visible in the current month grid
    // unless we're within 3 days of month-end; in that case widen the slots
    // response to also accept queries for next month (we serve the same slot).
    const slotStart = new Date();
    slotStart.setUTCDate(slotStart.getUTCDate() + 3);
    slotStart.setUTCHours(2, 0, 0, 0); // 11:00 JST
    const slotEnd = new Date(slotStart.getTime() + 30 * 60_000);

    await page.route(`**/public/links/${SLUG}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slug: SLUG,
          title: TITLE,
          description: "Quick intro",
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
        }),
      }),
    );

    await page.route(`**/public/links/${SLUG}/slots**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
          slots: [{ start: slotStart.toISOString(), end: slotEnd.toISOString() }],
        }),
      }),
    );

    let bookingPosted = false;
    const cancellationToken = "11111111-1111-4111-8111-111111111111";
    await page.route(`**/public/links/${SLUG}/bookings`, async (route, req) => {
      bookingPosted = true;
      const body = req.postDataJSON() as Record<string, string>;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          booking: {
            id: "bk-e2e-1",
            startAt: body.startAt ?? slotStart.toISOString(),
            endAt: slotEnd.toISOString(),
            guestName: body.guestName,
            guestEmail: body.guestEmail,
            status: "confirmed",
            meetUrl: "https://meet.google.com/abc-defg-hij",
            cancellationToken,
          },
        }),
      });
    });

    await page.goto(`/${SLUG}`);

    // Title + duration + tz row on the public page.
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText(/30 分/)).toBeVisible();

    // Wait for the slot fetch to settle.
    await expect(page.getByText("空き時間を取得中...")).toBeHidden();

    // Click the day cell. The grid uses UTC day-of-month as the cell label;
    // the available cell is the one matching slotStart's UTC date and inside
    // the currently-shown month. We pick the first ENABLED cell (the spillover
    // cells from prev/next month are disabled), regardless of label.
    const enabledDayCells = page
      .locator('button[type="button"]')
      .filter({ hasText: /^\d{1,2}$/ })
      .and(page.locator(":not([disabled])"));
    await expect(enabledDayCells.first()).toBeVisible();
    await enabledDayCells.first().click();

    // Click the first slot button. The button text is "HH:mm – HH:mm" but
    // exact tz formatting is not load-bearing — we just need any one to click.
    const slotButton = page
      .locator("button")
      .filter({ hasText: /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/ })
      .first();
    await expect(slotButton).toBeVisible();
    await slotButton.click();

    // Form step.
    await expect(page.getByRole("heading", { name: "あなたの情報" })).toBeVisible();
    await page.getByLabel("お名前").fill("E2E Guest");
    await page.getByLabel("メールアドレス").fill("guest@example.com");
    await page.getByLabel("メモ（任意）").fill("Looking forward to it.");
    await page.getByRole("button", { name: "予約を確定" }).click();

    // Confirmation card.
    await expect(page.getByRole("heading", { level: 1, name: "予約が確定しました" })).toBeVisible();
    await expect(page.getByText("https://meet.google.com/abc-defg-hij")).toBeVisible();
    await expect(page.getByText(cancellationToken)).toBeVisible();
    expect(bookingPosted).toBe(true);
  });
});
