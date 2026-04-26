import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("landing renders the hero heading and subtitle", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "SPIR 代替の社内日程調整" }),
    ).toBeVisible();
    await expect(page.getByText(/Google Calendar と連携/)).toBeVisible();
  });

  test("public booking page renders given an arbitrary slug", async ({ page }) => {
    await page.goto("/intro-30min");
    // The slug page is wired even before backend data exists; the heading echoes the slug.
    await expect(page.getByRole("heading", { level: 1, name: "intro-30min" })).toBeVisible();
  });

  test("unknown nested path falls through to the 404 page", async ({ page }) => {
    await page.goto("/this/does/not/exist");
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByRole("link", { name: "トップへ戻る" })).toBeVisible();
  });
});
