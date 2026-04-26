import { describe, expect, test } from "bun:test";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

describe("/me auth gate (router integration)", () => {
  test("GET /me without Authorization → 401", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(401);
  });

  test("GET /me with bogus Bearer → 401", async () => {
    const res = await app.request("/me", {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });
});
