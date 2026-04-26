import { describe, expect, test } from "bun:test";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

describe("/links auth gate", () => {
  test("GET /links → 401 unauth", async () => {
    const res = await app.request("/links");
    expect(res.status).toBe(401);
  });
  test("POST /links → 401 unauth", async () => {
    const res = await app.request("/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
  test("GET /links/slug-available → 401 unauth", async () => {
    const res = await app.request("/links/slug-available?slug=foo");
    expect(res.status).toBe(401);
  });
  test("GET /links/:id/owners → 401 unauth", async () => {
    const res = await app.request("/links/00000000-0000-0000-0000-000000000000/owners");
    expect(res.status).toBe(401);
  });
  test("PUT /links/:id/owners → 401 unauth", async () => {
    const res = await app.request("/links/00000000-0000-0000-0000-000000000000/owners", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [] }),
    });
    expect(res.status).toBe(401);
  });
});
