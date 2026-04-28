import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { httpFetch } from "./http";

// Capture window.location.replace calls so we can assert on redirect behaviour
// without triggering an actual navigation in JSDOM. We carry pathname through
// because the 401 handler reads it to skip the redirect on unauth landing
// pages (/sign-* and /invite/*).
const locationState: { pathname: string } = { pathname: "/dashboard" };
const replaceMock = vi.fn();
Object.defineProperty(window, "location", {
  value: {
    ...window.location,
    replace: replaceMock,
    get pathname() {
      return locationState.pathname;
    },
  },
  writable: true,
});

const mockHttpFetch = vi.mocked(httpFetch);

beforeEach(() => {
  mockHttpFetch.mockReset();
});

function setHandler(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  mockHttpFetch.mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    return impl(url, init);
  });
}

const noToken = async () => null;

describe("api.listLinks", () => {
  it("includes credentials and parses the links payload", async () => {
    let receivedInit: RequestInit | undefined;
    setHandler(async (_url, init) => {
      receivedInit = init;
      return new Response(JSON.stringify({ links: [] }), { status: 200 });
    });
    const res = await api.listLinks(noToken);
    expect(res.links).toEqual([]);
    expect(receivedInit?.credentials).toBe("include");
  });

  it("attaches Bearer token when getToken returns one", async () => {
    let authHeader: string | null = null;
    setHandler(async (_url, init) => {
      authHeader = new Headers(init?.headers).get("Authorization");
      return new Response(JSON.stringify({ links: [] }), { status: 200 });
    });
    await api.listLinks(async () => "test-jwt");
    expect(authHeader).toBe("Bearer test-jwt");
  });

  it("throws ApiError on non-2xx response", async () => {
    setHandler(
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    await expect(api.listLinks(noToken)).rejects.toBeInstanceOf(ApiError);
  });

  it("calls window.location.replace('/sign-in') on 401", async () => {
    replaceMock.mockClear();
    setHandler(
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    await expect(api.listLinks(noToken)).rejects.toBeInstanceOf(ApiError);
    expect(replaceMock).toHaveBeenCalledWith("/sign-in");
  });

  it("does not call window.location.replace on non-401 errors", async () => {
    replaceMock.mockClear();
    setHandler(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    await expect(api.listLinks(noToken)).rejects.toBeInstanceOf(ApiError);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not call window.location.replace on 401 when on /sign-in (avoids redirect loop)", async () => {
    replaceMock.mockClear();
    locationState.pathname = "/sign-in";
    setHandler(
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    await expect(api.listLinks(noToken)).rejects.toBeInstanceOf(ApiError);
    expect(replaceMock).not.toHaveBeenCalled();
    locationState.pathname = "/dashboard";
  });

  it("does not call window.location.replace on 401 when on /invite/:token (preserves landing)", async () => {
    replaceMock.mockClear();
    locationState.pathname = "/invite/abc123";
    setHandler(
      async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );
    await expect(api.listLinks(noToken)).rejects.toBeInstanceOf(ApiError);
    expect(replaceMock).not.toHaveBeenCalled();
    locationState.pathname = "/dashboard";
  });
});

describe("api.checkSlugAvailable", () => {
  it("URL-encodes the slug", async () => {
    let calledUrl = "";
    setHandler(async (url) => {
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
    setHandler(async (_url, init) => {
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
