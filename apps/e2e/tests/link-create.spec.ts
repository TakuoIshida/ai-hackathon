import { expect, test } from "@playwright/test";

// Scenario 2 of ISH-139:
//   Authenticated owner creates a link from /availability-sharings/new, then opens
//   the public URL and sees the calendar with at least one slot.
//
// All API endpoints are stubbed at the page-route layer:
//   - GET  /links              → drives the dashboard list before+after create
//   - GET  /links/slug-available → slug uniqueness debounce in the form
//   - POST /links              → create endpoint
//   - GET  /public/links/:slug → meta on the public page
//   - GET  /public/links/:slug/slots → one bookable slot today/tomorrow

test.describe("link create → public URL renders slots", () => {
  test("create a link from the dashboard, then see slots on the public URL", async ({ page }) => {
    const SLUG = "intro-30min-e2e";
    const TITLE = "Intro 30 min (E2E)";

    // Slug-availability endpoint: anything matching the path prefix returns
    // available=true. Registered FIRST so it has lowest priority — Playwright
    // matches in reverse registration order, so the more specific routes
    // below take precedence.
    let createdLink: Record<string, unknown> | null = null;
    await page.route("**/links/slug-available**", (route, req) => {
      const url = new URL(req.url());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ slug: url.searchParams.get("slug") ?? SLUG, available: true }),
      });
    });
    // Collection: GET → list, POST → create. Registered AFTER slug-available
    // so this catch-all doesn't shadow it.
    await page.route("**/links", async (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ links: createdLink ? [createdLink] : [] }),
        });
      }
      if (req.method() === "POST") {
        const body = req.postDataJSON() as { slug: string; title: string };
        createdLink = {
          id: "link-e2e-1",
          slug: body.slug,
          title: body.title,
          description: null,
          durationMinutes: 30,
          isPublished: true,
          timeZone: "Asia/Tokyo",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ link: { ...createdLink, ...body } }),
        });
      }
      return route.fallback();
    });

    // GET /public/links/:slug
    await page.route(`**/public/links/${SLUG}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slug: SLUG,
          title: TITLE,
          description: null,
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
        }),
      }),
    );

    // GET /public/links/:slug/slots — emit slots for today through today+35
    // days. Today is always inside the current month's calendar grid (the
    // grid always shows the month containing "today"), so the test never
    // breaks on month-boundary days. (A previous version emitted only one
    // slot at today+3, which silently broke on the last 2-3 days of any
    // month.) The slot's time is set to 14:00 UTC = 23:00 JST so today's
    // slot is still in the future for the typical 00-08 UTC CI window.
    const slots = Array.from({ length: 36 }, (_, i) => {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + i);
      start.setUTCHours(14, 0, 0, 0); // 23:00 JST
      const end = new Date(start.getTime() + 30 * 60_000);
      return { start: start.toISOString(), end: end.toISOString() };
    });
    await page.route(`**/public/links/${SLUG}/slots**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
          slots,
        }),
      }),
    );

    // Drive the form.
    await page.goto("/availability-sharings/new");
    await expect(page.getByRole("heading", { name: "新規リンク" })).toBeVisible();
    await page.getByLabel("スラッグ (URL)").fill(SLUG);
    await page.getByLabel("タイトル").fill(TITLE);
    // Wait for slug availability check to settle so the submit isn't blocked.
    await expect(page.getByText("✓ 利用可能")).toBeVisible();
    // Make sure the link is published so the public URL doesn't 404.
    await page.getByLabel("このリンクを公開する").check();
    await page.getByRole("button", { name: "作成" }).click();

    // After create the form navigates to /availability-sharings — the row we just
    // POSTed should be visible in the list.
    await expect(page).toHaveURL(/\/availability-sharings$/);
    await expect(page.getByText(TITLE)).toBeVisible();
    await expect(page.getByText(`/${SLUG}`)).toBeVisible();

    // Open the public URL — the calendar grid renders with at least one
    // available day (the one we seeded a slot on). Click it and verify the
    // slot button shows up.
    await page.goto(`/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText(/30 分/)).toBeVisible();

    // Wait for the grid to populate (slots loaded → cellAvailable styles set).
    await expect(page.getByText("空き時間を取得中...")).toBeHidden();

    // The grid renders 42 cells with UTC day-of-month labels; spillover cells
    // from the prev/next month are disabled. Picking the first ENABLED cell
    // (regardless of its day label) avoids tz/month edge cases that would
    // otherwise make this test flaky around the start/end of a month.
    const enabledDayCells = page
      .locator('button[type="button"]')
      .filter({ hasText: /^\d{1,2}$/ })
      .and(page.locator(":not([disabled])"));
    await expect(enabledDayCells.first()).toBeVisible();
    await enabledDayCells.first().click();

    // Slot list shows the formatted time button (HH:mm – HH:mm).
    await expect(
      page
        .locator("button")
        .filter({ hasText: /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/ })
        .first(),
    ).toBeVisible();
  });
});
