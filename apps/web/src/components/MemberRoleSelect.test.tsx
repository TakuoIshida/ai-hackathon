import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";

// Stable getToken reference — without this, every render returns a fresh
// closure and downstream effects re-fire (see Settings.test.tsx).
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
      changeMemberRole: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import { MemberRoleSelect } from "./MemberRoleSelect";

const mockedApi = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<MemberRoleSelect />", () => {
  test("canEdit=false renders a read-only badge (no <select>)", () => {
    render(
      <MemberRoleSelect
        workspaceId="ws-1"
        member={{ userId: "u-1", role: "owner" }}
        canEdit={false}
      />,
    );
    // badge is the role label
    const badge = screen.getByTestId("role-badge");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.textContent).toBe("owner");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("canEdit=true: change calls api.changeMemberRole with correct args and invokes onChanged", async () => {
    mockedApi.changeMemberRole.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(
      <MemberRoleSelect
        workspaceId="ws-1"
        member={{ userId: "u-2", role: "member" }}
        canEdit={true}
        onChanged={onChanged}
      />,
    );

    const select = screen.getByLabelText("role") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "owner" } });

    await waitFor(() => expect(mockedApi.changeMemberRole).toHaveBeenCalledTimes(1));
    expect(mockedApi.changeMemberRole).toHaveBeenCalledWith(
      "ws-1",
      "u-2",
      "owner",
      expect.any(Function),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  test("on 409 last_owner: shows error message and does NOT call onChanged", async () => {
    mockedApi.changeMemberRole.mockRejectedValue(new ApiError(409, "last_owner", "409 last_owner"));
    const onChanged = vi.fn();
    render(
      <MemberRoleSelect
        workspaceId="ws-1"
        member={{ userId: "u-3", role: "owner" }}
        canEdit={true}
        onChanged={onChanged}
      />,
    );

    fireEvent.change(screen.getByLabelText("role"), { target: { value: "member" } });

    await waitFor(() =>
      expect(screen.getByText(/最後の owner は降格できません/)).toBeInTheDocument(),
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
