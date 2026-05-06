import { expect, test } from "@playwright/test";

// Scenario 1 of ISH-139:
//   Sign in → dashboard renders.
//
// The web dev/preview server is started with VITE_E2E_BYPASS_AUTH=1
// (apps/e2e/playwright.config.ts). Vite swaps @clerk/clerk-react for a stub
// (apps/web/src/test/clerk-e2e-shim.tsx) that reports the user as signed-in.
// VITE_CLERK_PUBLISHABLE_KEY is also set so HAS_CLERK is truthy and the
// landing page shows the sign-in CTA instead of the "no Clerk configured"
// notice.
//
// All API calls are mocked with page.route() so this spec runs hermetically.
test.describe("signin → dashboard", () => {
  test("landing shows sign-in CTA, dashboard renders the brand and nav", async ({ page }) => {
    // ISH-227 swapped the post-signin landing from /dashboard (DashboardHome,
    // no API calls on mount) to /availability-sharings (Links.tsx). Links.tsx
    // calls GET /links via TanStack Query on mount (ISH-226). The api request
    // layer (apps/web/src/lib/api.ts) hard-redirects to /sign-in on a 401, so
    // we MUST mock /links to a 200 here — otherwise the e2e shim renders the
    // dashboard for a frame, the real API rejects the bypass token, and the
    // page jumps to /sign-in before the assertions run. /bookings is mocked
    // for the same reason on confirmed-list / booking-detail flows.
    await page.route("**/links", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ links: [] }) }),
    );
    await page.route("**/bookings", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ bookings: [] }) }),
    );

    await page.goto("/");

    // With Clerk wired up (even via the shim), the SignIn CTA must render.
    // The "no-Clerk" warning text would indicate a misconfigured webServer env.
    await expect(
      page.getByRole("heading", { level: 1, name: "SPIR 代替の社内日程調整" }),
    ).toBeVisible();
    await expect(page.getByText(/VITE_CLERK_PUBLISHABLE_KEY/)).toBeHidden();

    // ISH-227: top tab nav. Old /dashboard prefix removed; /dashboard now
    // 301-equivalent redirects to /availability-sharings via App.tsx.
    await page.goto("/availability-sharings");

    // Top tab nav — brand (Logo, ISH-230 / ISH-236) + each tab is a link with exact label.
    await expect(page.getByRole("heading", { level: 1, name: "Rips" })).toBeVisible();
    // ISH-259: Calendar / Forms / UnconfirmedList 画面は撤去済み。
    await expect(page.getByRole("link", { name: "空き時間リンク", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "確定済の予定", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "チーム設定", exact: true })).toBeVisible();

    // Body — Links page H1. ISH-237 (L-04) renamed it from "リンク" to
    // "空き時間リンク" to match the brand wording. level:1 + exact:true
    // disambiguates from the top tab nav link with the same text.
    await expect(
      page.getByRole("heading", { level: 1, name: "空き時間リンク", exact: true }),
    ).toBeVisible();
  });
});
