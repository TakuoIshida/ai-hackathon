import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { WorkspaceMember } from "@/lib/types";

// Stable getToken reference — without this, every render returns a fresh
// closure and `load`'s useCallback re-fires `useEffect`, eating queued
// mockResolvedValueOnce responses. Mirrors the Settings.test.tsx pattern.
vi.mock("@clerk/clerk-react", () => {
  const getToken = async () => "fake-token";
  return {
    useAuth: () => ({ getToken }),
    useUser: () => ({
      user: { primaryEmailAddress: { emailAddress: "owner@example.com" } },
    }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      listMembers: vi.fn(),
      removeMember: vi.fn(),
      // MemberRoleSelect is embedded inline; the integration test surface
      // doesn't trigger role change events, but we stub the method so any
      // accidental render-time access is a no-op rather than undefined.
      changeMemberRole: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import WorkspaceMembers from "./WorkspaceMembers";

const mockedApi = vi.mocked(api);

const ownerSelf: WorkspaceMember = {
  userId: "u-owner",
  email: "owner@example.com",
  name: "Owner Self",
  role: "owner",
  createdAt: "2026-04-01T00:00:00.000Z",
};
const memberA: WorkspaceMember = {
  userId: "u-a",
  email: "a@example.com",
  name: "A",
  role: "member",
  createdAt: "2026-04-02T00:00:00.000Z",
};
const memberB: WorkspaceMember = {
  userId: "u-b",
  email: "b@example.com",
  name: null,
  role: "member",
  createdAt: "2026-04-03T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<WorkspaceMembers /> list rendering", () => {
  test("renders each member's name (or email) and role", async () => {
    mockedApi.listMembers.mockResolvedValue({
      members: [ownerSelf, memberA, memberB],
      callerRole: "owner",
    });

    render(<WorkspaceMembers workspaceId="ws-1" />);

    expect(await screen.findByText("Owner Self")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    // memberB has no name → falls back to email as the title
    const matches = screen.getAllByText("b@example.com");
    expect(matches.length).toBeGreaterThan(0);
    // Owner self is shown as a read-only badge (cannot edit own role here).
    expect(screen.getByTestId("role-badge")).toHaveTextContent("owner");
    // The two non-self rows render editable role selects, each defaulting to
    // "member" (the current role). MemberRoleSelect labels the select as "role".
    const selects = screen.getAllByLabelText("role");
    expect(selects).toHaveLength(2);
    expect(selects.every((s) => (s as HTMLSelectElement).value === "member")).toBe(true);
  });

  test("shows an empty-state when there are no members", async () => {
    mockedApi.listMembers.mockResolvedValue({ members: [], callerRole: "owner" });
    render(<WorkspaceMembers workspaceId="ws-1" />);
    expect(await screen.findByText(/メンバーがいません/)).toBeInTheDocument();
  });

  test("surfaces an error when the list request fails", async () => {
    mockedApi.listMembers.mockRejectedValue(new ApiError(500, "boom", "500 boom"));
    render(<WorkspaceMembers workspaceId="ws-1" />);
    expect(await screen.findByText(/500 boom/)).toBeInTheDocument();
  });
});

describe("<WorkspaceMembers /> delete button visibility", () => {
  test("owner viewing other rows: delete button on every non-self row", async () => {
    mockedApi.listMembers.mockResolvedValue({
      members: [ownerSelf, memberA, memberB],
      callerRole: "owner",
    });

    render(<WorkspaceMembers workspaceId="ws-1" />);

    await screen.findByText("Owner Self");
    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    // 2 non-self rows → 2 buttons
    expect(deleteButtons.length).toBe(2);
  });

  test("member viewer: NO delete button on any row", async () => {
    mockedApi.listMembers.mockResolvedValue({
      members: [ownerSelf, memberA, memberB],
      callerRole: "member",
    });

    render(<WorkspaceMembers workspaceId="ws-1" />);

    await screen.findByText("Owner Self");
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  });

  test("owner viewing their own row: NO delete button on the self row", async () => {
    // Owner self is the only member of the workspace.
    mockedApi.listMembers.mockResolvedValue({
      members: [ownerSelf],
      callerRole: "owner",
    });

    render(<WorkspaceMembers workspaceId="ws-1" />);

    await screen.findByText("Owner Self");
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  });
});

describe("<WorkspaceMembers /> delete flow", () => {
  test("click → confirm → API call + reload", async () => {
    mockedApi.listMembers
      .mockResolvedValueOnce({
        members: [ownerSelf, memberA, memberB],
        callerRole: "owner",
      })
      .mockResolvedValueOnce({
        members: [ownerSelf, memberB],
        callerRole: "owner",
      });
    mockedApi.removeMember.mockResolvedValue({ ok: true });

    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    render(<WorkspaceMembers workspaceId="ws-1" />);

    await screen.findByText("A");
    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    fireEvent.click(deleteButtons[0]); // delete the first non-self row → memberA

    await waitFor(() =>
      expect(mockedApi.removeMember).toHaveBeenCalledWith("ws-1", "u-a", expect.any(Function)),
    );
    // Two listMembers calls: initial mount + post-delete reload.
    await waitFor(() => expect(mockedApi.listMembers).toHaveBeenCalledTimes(2));
    // After reload, A is gone from the list.
    await waitFor(() => expect(screen.queryByText("A")).toBeNull());

    confirmSpy.mockRestore();
  });

  test("click → confirm cancelled → no API call", async () => {
    mockedApi.listMembers.mockResolvedValue({
      members: [ownerSelf, memberA],
      callerRole: "owner",
    });

    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(false);

    render(<WorkspaceMembers workspaceId="ws-1" />);
    await screen.findByText("A");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(mockedApi.removeMember).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test("API 409 surfaces the status/code inline", async () => {
    mockedApi.listMembers.mockResolvedValue({
      members: [ownerSelf, memberA],
      callerRole: "owner",
    });
    mockedApi.removeMember.mockRejectedValue(new ApiError(409, "last_owner", "409 last_owner"));

    const confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);

    render(<WorkspaceMembers workspaceId="ws-1" />);
    await screen.findByText("A");
    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(await screen.findByText(/409 last_owner/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });
});
