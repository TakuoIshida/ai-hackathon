import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("landing renders the hero heading and subtitle", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "SPIR 代替の社内日程調整" }),
    ).toBeVisible();
    await expect(page.getByText(/Google Calendar と連携/)).toBeVisible();
  });

  test("public booking page renders the not_found card when the API returns 404", async ({
    page,
  }) => {
    // E2E runs without an API; intercept the public link fetch so the
    // PublicLink component reliably resolves to its not_found branch.
    await page.route("**/public/links/**", (route) =>
      route.fulfill({ status: 404, body: JSON.stringify({ error: "not_found" }) }),
    );
    await page.goto("/intro-30min");
    await expect(page.getByText("リンクが見つかりません")).toBeVisible();
  });

  test("unknown nested path falls through to the 404 page", async ({ page }) => {
    await page.goto("/this/does/not/exist");
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByRole("link", { name: "トップへ戻る" })).toBeVisible();
  });
});
