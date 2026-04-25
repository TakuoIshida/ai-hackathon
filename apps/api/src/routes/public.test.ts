import { describe, expect, test } from "bun:test";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

describe("/public/links/:slug", () => {
  test("validates query string format on /slots", async () => {
    // missing from/to → 400
    const res = await app.request("/public/links/anything/slots");
    expect(res.status).toBe(400);
  });

  test("rejects malformed datetime", async () => {
    const res = await app.request(
      "/public/links/x/slots?from=not-a-date&to=2026-04-27T00%3A00%3A00Z",
    );
    expect(res.status).toBe(400);
  });

  test("does not require auth (no 401)", async () => {
    const res = await app.request("/public/links/nonexistent");
    // either 404 not_found or 500 if DB unreachable, but never 401
    expect(res.status).not.toBe(401);
  });
});
