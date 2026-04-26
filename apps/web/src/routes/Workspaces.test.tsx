import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { WorkspaceSummary } from "@/lib/types";

// Stable getToken reference — without this, every render returns a fresh
// closure and `load`'s useCallback re-fires `useEffect`, eating queued
// mockResolvedValueOnce responses. Mirrors the Settings.test.tsx pattern.
vi.mock("@clerk/clerk-react", () => {
  const getToken = async () => "fake-token";
  return {
    useAuth: () => ({ getToken }),
  };
});

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listWorkspaces: vi.fn(),
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import Workspaces from "./Workspaces";

const mockedApi = vi.mocked(api);

const wsA: WorkspaceSummary = {
  id: "ws-a",
  slug: "acme",
  name: "Acme Inc.",
  role: "owner",
  createdAt: "2026-04-01T00:00:00.000Z",
};
const wsB: WorkspaceSummary = {
  id: "ws-b",
  slug: "globex",
  name: "Globex",
  role: "member",
  createdAt: "2026-04-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderWorkspaces() {
  return render(
    <MemoryRouter>
      <Workspaces />
    </MemoryRouter>,
  );
}

describe("<Workspaces /> list", () => {
  test("renders the workspaces returned by the API with name, slug, and role", async () => {
    mockedApi.listWorkspaces.mockResolvedValue({ workspaces: [wsA, wsB] });

    renderWorkspaces();

    expect(await screen.findByText("Acme Inc.")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
    expect(screen.getByText("/acme")).toBeInTheDocument();
    expect(screen.getByText("/globex")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  test("shows an empty-state when the user has no workspaces yet", async () => {
    mockedApi.listWorkspaces.mockResolvedValue({ workspaces: [] });

    renderWorkspaces();

    expect(await screen.findByText(/まだワークスペースがありません/)).toBeInTheDocument();
  });

  test("surfaces an error message when the list request fails", async () => {
    mockedApi.listWorkspaces.mockRejectedValue(new ApiError(500, "boom", "500 boom"));

    renderWorkspaces();

    expect(await screen.findByText(/500 boom/)).toBeInTheDocument();
  });
});

describe("<Workspaces /> create form", () => {
  test("submitting calls createWorkspace and navigates to the detail page", async () => {
    mockedApi.listWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedApi.createWorkspace.mockResolvedValue({
      workspace: {
        id: "ws-new",
        slug: "fresh",
        name: "Fresh",
        role: "owner",
        createdAt: "2026-04-25T00:00:00.000Z",
      },
    });

    renderWorkspaces();
    // wait for initial list to settle so the form is around
    await screen.findByText(/まだワークスペースがありません/);

    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "Fresh" } });
    fireEvent.change(screen.getByLabelText("スラッグ"), { target: { value: "fresh" } });
    fireEvent.click(screen.getByRole("button", { name: /作成/ }));

    await waitFor(() =>
      expect(mockedApi.createWorkspace).toHaveBeenCalledWith(
        { name: "Fresh", slug: "fresh" },
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard/workspaces/ws-new"));
  });

  test("shows a friendly message when the API responds 409 slug_already_taken", async () => {
    mockedApi.listWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedApi.createWorkspace.mockRejectedValue(
      new ApiError(409, "slug_already_taken", "409 conflict"),
    );

    renderWorkspaces();
    await screen.findByText(/まだワークスペースがありません/);

    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("スラッグ"), { target: { value: "duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: /作成/ }));

    expect(await screen.findByText(/このスラッグは使用済みです/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("submit button is disabled while the slug is empty or invalid", async () => {
    mockedApi.listWorkspaces.mockResolvedValue({ workspaces: [] });

    renderWorkspaces();
    await screen.findByText(/まだワークスペースがありません/);

    const submit = screen.getByRole("button", { name: /作成/ });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("名前"), { target: { value: "X" } });
    // invalid slug (uppercase)
    fireEvent.change(screen.getByLabelText("スラッグ"), { target: { value: "BAD Slug" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("スラッグ"), { target: { value: "ok-slug" } });
    expect(submit).not.toBeDisabled();
  });
});
