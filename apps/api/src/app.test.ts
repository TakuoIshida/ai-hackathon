import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("GET /health", () => {
  test("returns 200 with service identifier", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "api" });
  });
});

describe("unknown route", () => {
  test("returns 404", async () => {
    const res = await app.request("/does-not-exist");

    expect(res.status).toBe(404);
  });
});
