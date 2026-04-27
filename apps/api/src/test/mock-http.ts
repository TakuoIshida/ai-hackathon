import { mock } from "bun:test";
import type { FetchLike } from "@/lib/http";

// Stable mock function — created once. Tests configure behavior via
// `httpFetchMock.mockImplementation(...)` (or `...Once`) per test.
//
// Importing this module installs the `mock.module("@/lib/http", ...)` swap
// as a side-effect, so SUT modules that `import { httpFetch } from "@/lib/http"`
// pick up this mock instead of the real wrapper around `globalThis.fetch`.
//
// This intentionally does NOT touch `globalThis.fetch`, so the Neon Local HTTP
// backend (which uses `globalThis.fetch` for DB queries via @neondatabase/serverless)
// continues to work untouched. No URL prefix gating required.
export const httpFetchMock = mock<FetchLike>(async () => {
  throw new Error(
    "httpFetch mock not configured — call httpFetchMock.mockImplementation(...) in your test",
  );
});

mock.module("@/lib/http", () => ({
  httpFetch: httpFetchMock,
}));
