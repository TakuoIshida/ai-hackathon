import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

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

const noToken = async () => null;

describe("api.listLinks", () => {
  it("includes credentials and parses the links payload", async () => {
    let receivedInit: RequestInit | undefined;
    mockFetch(async (_url, init) => {
      receivedInit = init;
      return new Response(JSON.stringify({ links: [] }), { status: 200 });
    });
    const res = await api.listLinks(noToken);
    expect(res.links).toEqual([]);
    expect(receivedInit?.credentials).toBe("include");
  });

  it("attaches Bearer token when getToken returns one", async () => {
    let authHeader: string | null = null;
    mockFetch(async (_url, init) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ links: [] }), { status: 200 });
    });
    await api.listLinks(async () => "test-jwt");
    expect(authHeader).toBe("Bearer test-jwt");
  });

  it("throws ApiError on non-2xx response", async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    await expect(api.listLinks(noToken)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("api.checkSlugAvailable", () => {
  it("URL-encodes the slug", async () => {
    let calledUrl = "";
    mockFetch(async (url) => {
      calledUrl = url;
      return new Response(JSON.stringify({ slug: "my slug", available: true }), { status: 200 });
    });
    await api.checkSlugAvailable("my slug", noToken);
    expect(calledUrl).toContain("slug=my%20slug");
  });
});

describe("api.createLink", () => {
  it("posts JSON body with the input payload", async () => {
    let body: string | undefined;
    let method: string | undefined;
    mockFetch(async (_url, init) => {
      body = String(init?.body);
      method = init?.method;
      return new Response(JSON.stringify({ link: { id: "new-id" } }), { status: 201 });
    });
    await api.createLink(
      {
        slug: "x",
        title: "X",
        description: "",
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        slotIntervalMinutes: null,
        maxPerDay: null,
        leadTimeHours: 0,
        rangeDays: 60,
        timeZone: "Asia/Tokyo",
        isPublished: false,
        rules: [],
        excludes: [],
      },
      noToken,
    );
    expect(method).toBe("POST");
    expect(body).toContain('"slug":"x"');
  });
});
