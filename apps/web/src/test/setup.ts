import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Mock the httpFetch wrapper so any module that calls `httpFetch(...)` goes
// through a vi.fn() instead of the real network. Tests configure behavior with
// `vi.mocked(httpFetch).mockImplementation(...)` per scenario. Vitest hoists
// this `vi.mock` call to before any imports, so SUT modules see the mock from
// their first evaluation.
vi.mock("@/lib/http", () => ({
  httpFetch: vi.fn(async () => {
    throw new Error(
      "httpFetch mock not configured — call vi.mocked(httpFetch).mockImplementation(...) in your test",
    );
  }),
}));

afterEach(() => {
  cleanup();
});
