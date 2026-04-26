import { expect, test } from "@playwright/test";

// Scenario 5 of ISH-139:
//   A guest opens the cancellation link sent in their confirmation email
//   (/cancel/:token), confirms, and sees the "予約をキャンセルしました" card.
//
// Cancel route is public — no Clerk involvement. We just stub the API
// response for POST /public/cancel/:token.

test.describe("guest-side cancel link", () => {
  test("guest opens /cancel/:token and confirms the cancellation", async ({ page }) => {
    const TOKEN = "22222222-2222-4222-8222-222222222222";

    let posted = false;
    await page.route(`**/public/cancel/${TOKEN}`, async (route, req) => {
      // The frontend POSTs without a body; respond with the success shape.
      posted = req.method() === "POST";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, bookingId: "bk-guest-cancel-1" }),
      });
    });

    await page.goto(`/cancel/${TOKEN}`);

    await expect(page.getByRole("heading", { name: "予約をキャンセルしますか？" })).toBeVisible();
    // The token is shown in a <code> for debugging.
    await expect(page.getByText(TOKEN)).toBeVisible();

    await page.getByRole("button", { name: "キャンセル確定" }).click();

    // Success state.
    await expect(page.getByRole("heading", { name: "予約をキャンセルしました" })).toBeVisible();
    expect(posted).toBe(true);
  });

  test("invalid token surfaces the not_found card", async ({ page }) => {
    const TOKEN = "33333333-3333-4333-8333-333333333333";

    await page.route(`**/public/cancel/${TOKEN}`, (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_found" }),
      }),
    );

    await page.goto(`/cancel/${TOKEN}`);
    await page.getByRole("button", { name: "キャンセル確定" }).click();
    await expect(
      page.getByRole("heading", { name: "キャンセルリンクが見つかりません" }),
    ).toBeVisible();
  });
});
