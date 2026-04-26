import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicLink, fetchPublicSlots, PublicApiError, postPublicBooking } from "./public-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn((input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    return impl(url, init);
  }) as typeof fetch;
}

describe("fetchPublicLink", () => {
  it("returns the parsed link payload on a 2xx response", async () => {
    let calledUrl = "";
    mockFetch(async (url) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          slug: "intro-30",
          title: "30 minute intro",
          description: null,
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
        }),
        { status: 200 },
      );
    });
    const link = await fetchPublicLink("intro-30");
    expect(link.slug).toBe("intro-30");
    expect(link.durationMinutes).toBe(30);
    expect(calledUrl).toContain("/public/links/intro-30");
  });

  it("URL-encodes the slug", async () => {
    let calledUrl = "";
    mockFetch(async (url) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({
          slug: "with space",
          title: "x",
          description: null,
          durationMinutes: 30,
          timeZone: "Asia/Tokyo",
        }),
        { status: 200 },
      );
    });
    await fetchPublicLink("with space");
    expect(calledUrl).toContain("/public/links/with%20space");
  });

  it("throws PublicApiError on a 4xx response carrying the server error code", async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    await expect(fetchPublicLink("missing")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(fetchPublicLink("missing")).rejects.toBeInstanceOf(PublicApiError);
  });

  it("falls back to request_failed when the error body is empty / not JSON", async () => {
    mockFetch(async () => new Response("", { status: 500 }));
    await expect(fetchPublicLink("x")).rejects.toMatchObject({
      status: 500,
      code: "request_failed",
    });
  });
});

describe("fetchPublicSlots", () => {
  it("passes from/to as query params", async () => {
    let calledUrl = "";
    mockFetch(async (url) => {
      calledUrl = url;
      return new Response(
        JSON.stringify({ durationMinutes: 30, timeZone: "Asia/Tokyo", slots: [] }),
        { status: 200 },
      );
    });
    await fetchPublicSlots("intro-30", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z");
    expect(calledUrl).toContain("from=2026-04-01T00%3A00%3A00Z");
    expect(calledUrl).toContain("to=2026-05-01T00%3A00%3A00Z");
  });
});

describe("postPublicBooking", () => {
  it("posts JSON body and returns the unwrapped booking", async () => {
    let receivedBody = "";
    let receivedMethod = "";
    mockFetch(async (_url, init) => {
      receivedBody = String(init?.body);
      receivedMethod = String(init?.method);
      return new Response(
        JSON.stringify({
          booking: {
            id: "b1",
            startAt: "2026-04-26T01:00:00Z",
            endAt: "2026-04-26T01:30:00Z",
            guestName: "Alice",
            guestEmail: "alice@example.com",
            status: "confirmed",
            meetUrl: null,
            cancellationToken: "tok",
          },
        }),
        { status: 201 },
      );
    });
    const booking = await postPublicBooking("intro-30", {
      startAt: "2026-04-26T01:00:00Z",
      guestName: "Alice",
      guestEmail: "alice@example.com",
    });
    expect(receivedMethod).toBe("POST");
    expect(receivedBody).toContain('"guestName":"Alice"');
    expect(booking.id).toBe("b1");
    expect(booking.cancellationToken).toBe("tok");
  });

  it("throws PublicApiError on 4xx", async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: "slot_taken" }), { status: 409 }));
    await expect(
      postPublicBooking("x", {
        startAt: "2026-04-26T01:00:00Z",
        guestName: "A",
        guestEmail: "a@example.com",
      }),
    ).rejects.toMatchObject({ status: 409, code: "slot_taken" });
  });
});
