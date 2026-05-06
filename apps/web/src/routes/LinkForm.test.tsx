import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@clerk/clerk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/clerk-react")>();
  const getToken = async () => "fake-token";
  return {
    ...actual,
    useAuth: () => ({ getToken }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      createLink: vi.fn(),
      checkSlugAvailable: vi.fn(),
    },
  };
});

import { ApiError, api } from "@/lib/api";
import type { LinkDetail } from "@/lib/types";
import LinkForm from "./LinkForm";

const stubLink: LinkDetail = {
  id: "new-id",
  slug: "intro",
  title: "Intro 30",
  description: null,
  durationMinutes: 30,
  isPublished: false,
  timeZone: "Asia/Tokyo",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  slotIntervalMinutes: null,
  maxPerDay: null,
  leadTimeHours: 0,
  rangeDays: 60,
  rules: [],
  excludes: [],
};

const mockedApi = vi.mocked(api);

function renderForm() {
  return render(
    <MemoryRouter initialEntries={["/availability-sharings/new"]}>
      <Routes>
        <Route path="/availability-sharings/new" element={<LinkForm />} />
        <Route path="/availability-sharings" element={<div>Links list page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: slug check resolves as available so we don't accidentally disable the submit button.
  mockedApi.checkSlugAvailable.mockResolvedValue({ slug: "intro", available: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("<LinkForm />", () => {
  test("validation: shows the 'taken' message and disables submit when slug is unavailable", async () => {
    mockedApi.checkSlugAvailable.mockResolvedValue({ slug: "taken-slug", available: false });

    renderForm();

    fireEvent.change(screen.getByLabelText("スラッグ (URL)"), {
      target: { value: "taken-slug" },
    });

    expect(await screen.findByText("このスラッグは使用済みです")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /リンクを発行/ });
    expect(submit).toBeDisabled();
  });

  test("submit success: calls api.createLink and navigates to the list page", async () => {
    mockedApi.createLink.mockResolvedValue({ link: stubLink });

    renderForm();

    fireEvent.change(screen.getByLabelText("スラッグ (URL)"), { target: { value: "intro" } });
    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "Intro 30" } });

    // Wait for the slug debounce (300ms) to settle as "available"
    await screen.findByText("✓ 利用可能");

    fireEvent.click(screen.getByRole("button", { name: /リンクを発行/ }));

    await waitFor(() => expect(mockedApi.createLink).toHaveBeenCalledTimes(1));
    expect(mockedApi.createLink).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "intro", title: "Intro 30" }),
      expect.any(Function),
    );

    // Navigation to the links list happened
    await waitFor(() => expect(screen.getByText("Links list page")).toBeInTheDocument());
  });

  test("submit error: surfaces the ApiError status/code in the form", async () => {
    mockedApi.createLink.mockRejectedValue(new ApiError(409, "slug_taken", "409 Conflict"));

    renderForm();

    fireEvent.change(screen.getByLabelText("スラッグ (URL)"), { target: { value: "intro" } });
    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "Intro 30" } });
    await screen.findByText("✓ 利用可能");

    fireEvent.click(screen.getByRole("button", { name: /リンクを発行/ }));

    expect(await screen.findByText("409: slug_taken")).toBeInTheDocument();
    // The user remains on the form (not on the redirected list page).
    expect(screen.queryByText("Links list page")).toBeNull();
  });

  // --- ISH-244: form mode の曜日×時間帯 UI を再構成 ---
  test("form mode: preset chip click updates the from/to inputs", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "1ヶ月" }));
    const from = screen.getByLabelText("公開期間 開始日") as HTMLInputElement;
    const to = screen.getByLabelText("公開期間 終了日") as HTMLInputElement;
    // From=today; To=today+30. We can't pin "today" globally here, but we can
    // assert (a) preset is now active and (b) from === today's input value.
    expect(from.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole("button", { name: "1ヶ月" })).toHaveAttribute("aria-pressed", "true");
    // diff(to, from) should be exactly 30 days
    const dayMs = 86400000;
    const diff = Math.round(
      (new Date(to.value).getTime() - new Date(from.value).getTime()) / dayMs,
    );
    expect(diff).toBe(30);
  });

  test("form mode: weekday toggle on → off replaces time inputs with '受付なし'", () => {
    renderForm();
    // emptyInput has Mon-Fri populated with 9-17 ranges; only Sat/Sun start off.
    expect(screen.getAllByText("受付なし")).toHaveLength(2);
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("09:00");

    // Toggle monday off
    fireEvent.click(screen.getByLabelText("月曜日 受付"));

    expect(screen.queryByLabelText("月曜日 1番目 開始時刻")).toBeNull();
    expect(screen.getAllByText("受付なし")).toHaveLength(3);

    // Toggle monday back on → default 09-17
    fireEvent.click(screen.getByLabelText("月曜日 受付"));
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("09:00");
    expect(screen.getByLabelText("月曜日 1番目 終了時刻")).toHaveValue("17:00");
  });

  test("form mode: '平日に一括適用' copies monday's ranges to tue-fri", () => {
    renderForm();
    // Tighten monday to 10-12
    fireEvent.change(screen.getByLabelText("月曜日 1番目 開始時刻"), {
      target: { value: "10:00" },
    });
    fireEvent.change(screen.getByLabelText("月曜日 1番目 終了時刻"), {
      target: { value: "12:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: /平日に一括適用/ }));

    for (const day of ["月", "火", "水", "木", "金"]) {
      expect(screen.getByLabelText(`${day}曜日 1番目 開始時刻`)).toHaveValue("10:00");
      expect(screen.getByLabelText(`${day}曜日 1番目 終了時刻`)).toHaveValue("12:00");
    }
    // 土日 stay off
    expect(screen.getAllByText("受付なし")).toHaveLength(2);
  });
});
