import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Webhook } from "svix";
import { setConfigForTests } from "./config";

// pk_test_<base64("example.com$")> — a syntactically valid stub publishable key.
process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("./app");

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

describe("GET /me", () => {
  test("returns 401 when unauthenticated", async () => {
    const res = await app.request("/me", { headers: { Origin: "http://localhost" } });
    expect(res.status).toBe(401);
  });
});

describe("POST /webhooks/clerk", () => {
  const SECRET_BYTES = new Uint8Array(32);
  for (let i = 0; i < 32; i++) SECRET_BYTES[i] = 0xab;
  const SECRET = `whsec_${Buffer.from(SECRET_BYTES).toString("base64")}`;

  let restoreConfig: Partial<{ clerkWebhookSecret: string | undefined }> = {};

  beforeAll(() => {
    // ISH-128: routes read from `config` (loaded once at startup), not
    // process.env. Mutate the singleton via the test helper so the webhook
    // route picks up the test secret while still asserting the centralized
    // wiring works end-to-end.
    restoreConfig = setConfigForTests({ clerkWebhookSecret: SECRET });
  });
  afterAll(() => {
    setConfigForTests(restoreConfig);
  });

  test("returns 400 when svix headers are missing", async () => {
    const res = await app.request("/webhooks/clerk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 on invalid signature", async () => {
    const res = await app.request("/webhooks/clerk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": "msg_1",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,xxxxx",
      },
      body: JSON.stringify({ type: "user.created", data: {} }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 200 on a correctly signed unhandled event type (no DB write)", async () => {
    const wh = new Webhook(SECRET);
    const id = "msg_2";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = JSON.stringify({ type: "session.created", data: {} });
    const signature = wh.sign(id, new Date(Number(timestamp) * 1000), payload);

    const res = await app.request("/webhooks/clerk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": signature,
      },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
