import { describe, expect, test } from "bun:test";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

describe("/tenant/members auth gate (ISH-250)", () => {
  test("GET /tenant/members → 401 unauth", async () => {
    const res = await app.request("/tenant/members", { method: "GET" });
    expect(res.status).toBe(401);
  });
});
