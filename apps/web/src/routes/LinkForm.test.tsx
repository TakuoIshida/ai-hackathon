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
      updateLink: vi.fn(),
    },
  };
});

import { ToastProvider } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import type { LinkDetail } from "@/lib/types";
import LinkForm from "./LinkForm";

const stubLink: LinkDetail = {
  id: "new-id",
  slug: "abc12345",
  title: "Intro 30",
  description: null,
  durationMinutes: 30,
  timeZone: "Asia/Tokyo",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
  rangeDays: 60,
  rules: [],
};

const mockedApi = vi.mocked(api);

function renderForm() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/availability-sharings/new"]}>
        <Routes>
          <Route path="/availability-sharings/new" element={<LinkForm />} />
          <Route path="/availability-sharings/:id/edit" element={<LinkForm />} />
          <Route path="/availability-sharings" element={<div>Links list page</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("<LinkForm />", () => {
  // ISH-296 (B/C): スラッグ / タイムゾーンの Input は FE から削除済み
  test("does not render slug or timezone inputs", () => {
    renderForm();
    expect(screen.queryByLabelText(/スラッグ/)).toBeNull();
    expect(screen.queryByLabelText(/タイムゾーン/)).toBeNull();
  });

  test("submit success: omits slug from payload (BE auto-generates) and navigates", async () => {
    mockedApi.createLink.mockResolvedValue({ link: stubLink });

    renderForm();

    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "Intro 30" } });

    fireEvent.click(screen.getByRole("button", { name: /リンクを発行/ }));

    await waitFor(() => expect(mockedApi.createLink).toHaveBeenCalledTimes(1));
    const sentPayload = mockedApi.createLink.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sentPayload.title).toBe("Intro 30");
    expect(sentPayload.timeZone).toBe("Asia/Tokyo");
    // ISH-296 (B): slug は payload に乗せない (BE が auto-generate する)
    expect("slug" in sentPayload).toBe(false);

    // Navigation to the links list happened
    await waitFor(() => expect(screen.getByText("Links list page")).toBeInTheDocument());
  });

  test("submit error: surfaces the ApiError status/code in the form", async () => {
    mockedApi.createLink.mockRejectedValue(new ApiError(409, "slug_taken", "409 Conflict"));

    renderForm();

    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "Intro 30" } });

    fireEvent.click(screen.getByRole("button", { name: /リンクを発行/ }));

    expect(await screen.findByText("409: slug_taken")).toBeInTheDocument();
    // The user remains on the form (not on the redirected list page).
    expect(screen.queryByText("Links list page")).toBeNull();
  });

  // ISH-297: 下書き保存 button が常時 enable で、押下で同ページに留まる
  test("draft save: button is enabled and stays on the page after success", async () => {
    mockedApi.createLink.mockResolvedValue({ link: stubLink });

    renderForm();

    fireEvent.change(screen.getByLabelText("タイトル"), { target: { value: "Intro 30" } });

    const draftBtn = screen.getByRole("button", { name: /下書き保存/ });
    expect(draftBtn).not.toBeDisabled();
    fireEvent.click(draftBtn);

    await waitFor(() => expect(mockedApi.createLink).toHaveBeenCalledTimes(1));
    // navigates to /availability-sharings/{id}/edit (replace) — list page is not shown.
    expect(screen.queryByText("Links list page")).toBeNull();
  });

  // --- ISH-244: form mode の曜日×時間帯 UI を再構成 ---
  test("form mode: preset chip click updates the from/to inputs", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "1ヶ月" }));
    const from = screen.getByLabelText("公開期間 開始日") as HTMLInputElement;
    const to = screen.getByLabelText("公開期間 終了日") as HTMLInputElement;
    expect(from.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole("button", { name: "1ヶ月" })).toHaveAttribute("aria-pressed", "true");
    const dayMs = 86400000;
    const diff = Math.round(
      (new Date(to.value).getTime() - new Date(from.value).getTime()) / dayMs,
    );
    expect(diff).toBe(30);
  });

  test("form mode: weekday toggle on → off replaces time inputs with '受付なし'", () => {
    renderForm();
    expect(screen.getAllByText("受付なし")).toHaveLength(2);
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("09:00");

    fireEvent.click(screen.getByLabelText("月曜日 受付"));

    expect(screen.queryByLabelText("月曜日 1番目 開始時刻")).toBeNull();
    expect(screen.getAllByText("受付なし")).toHaveLength(3);

    fireEvent.click(screen.getByLabelText("月曜日 受付"));
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("09:00");
    expect(screen.getByLabelText("月曜日 1番目 終了時刻")).toHaveValue("17:00");
  });

  test("form mode: '平日に一括適用' copies monday's ranges to tue-fri", () => {
    renderForm();
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
    expect(screen.getAllByText("受付なし")).toHaveLength(2);
  });
});
