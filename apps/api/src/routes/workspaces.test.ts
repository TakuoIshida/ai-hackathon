import { describe, expect, test } from "bun:test";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");

describe("/workspaces auth gate (ISH-108)", () => {
  const idPath = "/workspaces/00000000-0000-0000-0000-000000000000/invitations";

  test("POST /workspaces/:id/invitations → 401 unauth", async () => {
    const res = await app.request(idPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@x.com" }),
    });
    expect(res.status).toBe(401);
  });

  test("DELETE /workspaces/:id/invitations → 401 unauth", async () => {
    const res = await app.request(idPath, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@x.com" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("/workspaces auth gate (ISH-107)", () => {
  test("GET /workspaces → 401 unauth", async () => {
    const res = await app.request("/workspaces", { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("POST /workspaces → 401 unauth", async () => {
    const res = await app.request("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", slug: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("GET /workspaces/:id → 401 unauth", async () => {
    const res = await app.request("/workspaces/00000000-0000-0000-0000-000000000000", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });
});
