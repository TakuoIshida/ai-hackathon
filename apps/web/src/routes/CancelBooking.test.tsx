import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CancelBooking from "./CancelBooking";

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn((input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    return impl(url, init);
  }) as typeof fetch;
}

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/cancel/${token}`]}>
      <Routes>
        <Route path="/cancel/:token" element={<CancelBooking />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("<CancelBooking />", () => {
  test("reads the token from the URL, posts to the cancel endpoint, and shows success", async () => {
    let calledUrl = "";
    let calledMethod = "";
    mockFetch(async (url, init) => {
      calledUrl = url;
      calledMethod = String(init?.method);
      return new Response(JSON.stringify({ ok: true, alreadyCanceled: false }), { status: 200 });
    });

    renderAt("abc123");

    // Token surfaces in the confirmation pane before clicking
    expect(screen.getByText("abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル確定" }));

    await waitFor(() => expect(screen.getByText("予約をキャンセルしました")).toBeInTheDocument());
    expect(calledMethod).toBe("POST");
    expect(calledUrl).toContain("/public/cancel/abc123");
  });

  test("shows the not-found pane when the API returns 404 for an invalid token", async () => {
    mockFetch(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

    renderAt("badtoken");

    fireEvent.click(screen.getByRole("button", { name: "キャンセル確定" }));

    await waitFor(() =>
      expect(screen.getByText("キャンセルリンクが見つかりません")).toBeInTheDocument(),
    );
  });
});
