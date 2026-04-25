import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("home renders the scaffold heading and subtitle", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "AI Hackathon" })).toBeVisible();
    await expect(page.getByText(/Hono \+ React \+ Radix Primitives \+ StyleX/)).toBeVisible();
  });

  test("Ping API button calls /health and shows the payload", async ({ page }) => {
    await page.goto("/");

    // Auto-accept the alert dialog the button shows.
    page.on("dialog", (dialog) => dialog.accept());

    // Listen for the /health response triggered by the click.
    const responsePromise = page.waitForResponse(
      (res) => res.url().endsWith("/health") && res.request().method() === "GET",
    );

    await page.getByRole("button", { name: /ping api/i }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { ok: boolean; service: string };
    expect(body).toEqual({ ok: true, service: "api" });
  });
});
