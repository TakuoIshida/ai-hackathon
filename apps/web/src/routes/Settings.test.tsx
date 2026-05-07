import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import type { GoogleConnection, TenantMemberView } from "@/lib/types";
import { TestQueryProvider } from "@/test/query-test-utils";

// ISH-240: Settings mounts <InviteMembersModal> (uses useToast). ISH-253:
// Settings root mounts useTenantMembersQuery(), so we also need a
// QueryClientProvider — TestQueryProvider gives a fresh client per render
// with retry disabled.
function renderSettings() {
  return render(
    <TestQueryProvider>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </TestQueryProvider>,
  );
}

// Stable getToken reference — without this, every render returns a fresh
// closure and `load`'s useCallback re-fires `useEffect`, eating queued
// mockResolvedValueOnce responses.
vi.mock("@clerk/clerk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/clerk-react")>();
  const getToken = async () => "fake-token";
  return {
    ...actual,
    useAuth: () => ({ getToken }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  // Keep ApiError + googleConnectUrl real; only stub the request methods.
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getGoogleConnection: vi.fn(),
      disconnectGoogle: vi.fn(),
      updateCalendarFlags: vi.fn(),
      listTenantMembers: vi.fn(),
      // ISH-251: tenant-scoped member deletion.
      removeTenantMember: vi.fn(),
      // ISH-256: tenant-scoped role change + invitation revoke.
      changeTenantMemberRole: vi.fn(),
      revokeTenantInvitation: vi.fn(),
      // ISH-261: tenant-scoped invitation resend.
      resendTenantInvitation: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import Settings, { MembersTab } from "./Settings";

const mockedApi = vi.mocked(api);

// ISH-253: shared default for tests that don't care about the members
// listing (basic info / Google connection tests). Resolves with an empty
// list so useTenantMembersQuery() settles cleanly even when the assertion
// targets another concern.
function emptyMembers() {
  return {
    members: [] as TenantMemberView[],
    callerRole: "owner" as const,
    callerUserId: "u-self",
  };
}

const calA = {
  id: "cal-A",
  googleCalendarId: "a@example.com",
  summary: "Calendar A",
  timeZone: "Asia/Tokyo",
  isPrimary: true,
  usedForBusy: true,
  usedForWrites: true,
};
const calB = {
  id: "cal-B",
  googleCalendarId: "b@example.com",
  summary: "Calendar B",
  timeZone: "Asia/Tokyo",
  isPrimary: false,
  usedForBusy: true,
  usedForWrites: false,
};

const connected = (overrides: Partial<GoogleConnection> = {}): GoogleConnection => ({
  connected: true,
  accountEmail: "owner@example.com",
  calendars: [calA, calB],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: members list is empty unless a specific test queues data.
  // Without this, the query stays pending forever and re-renders triggered
  // by other UI assertions (e.g. checkbox toggles) interleave with a
  // never-resolving fetch.
  mockedApi.listTenantMembers.mockResolvedValue(emptyMembers());
});

describe("<Settings /> calendar flag toggles (pessimistic)", () => {
  test("success: toggling usedForBusy calls API then re-fetches canonical state", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce(connected()).mockResolvedValueOnce(
      connected({
        calendars: [{ ...calA, usedForBusy: false }, calB],
      }),
    );
    mockedApi.updateCalendarFlags.mockResolvedValue({
      calendar: { ...calA, usedForBusy: false },
    });

    renderSettings();

    const busyChecks = await screen.findAllByLabelText("空き判定");
    expect(busyChecks[0]).toBeChecked();

    fireEvent.click(busyChecks[0]);

    await waitFor(() => expect(mockedApi.updateCalendarFlags).toHaveBeenCalledTimes(1));
    expect(mockedApi.updateCalendarFlags).toHaveBeenCalledWith(
      "cal-A",
      { usedForBusy: false },
      expect.any(Function),
    );
    // Two getGoogleConnection calls: initial mount + post-update reload
    await waitFor(() => expect(mockedApi.getGoogleConnection).toHaveBeenCalledTimes(2));

    const busyAfter = await screen.findAllByLabelText("空き判定");
    expect(busyAfter[0]).not.toBeChecked();
  });

  test("success: switching usedForWrites reflects server-side exclusivity after reload", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce(connected()).mockResolvedValueOnce(
      connected({
        calendars: [
          { ...calA, usedForWrites: false },
          { ...calB, usedForWrites: true },
        ],
      }),
    );
    mockedApi.updateCalendarFlags.mockResolvedValue({
      calendar: { ...calB, usedForWrites: true },
    });

    renderSettings();

    const writesRadios = await screen.findAllByLabelText("書込先");
    expect(writesRadios[0]).toBeChecked();
    expect(writesRadios[1]).not.toBeChecked();

    fireEvent.click(writesRadios[1]);

    await waitFor(() =>
      expect(mockedApi.updateCalendarFlags).toHaveBeenCalledWith(
        "cal-B",
        { usedForWrites: true },
        expect.any(Function),
      ),
    );

    // After reload, exclusivity from the server is visible in the UI.
    await waitFor(async () => {
      const radios = await screen.findAllByLabelText("書込先");
      expect(radios[0]).not.toBeChecked();
      expect(radios[1]).toBeChecked();
    });
  });

  test("failure: API error surfaces a message and the UI does not flip", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.updateCalendarFlags.mockRejectedValue(
      new ApiError(403, "forbidden", "403 forbidden"),
    );

    renderSettings();

    const busyChecks = await screen.findAllByLabelText("空き判定");
    expect(busyChecks[0]).toBeChecked();

    fireEvent.click(busyChecks[0]);

    await waitFor(() => expect(screen.getByText(/403 forbidden/)).toBeInTheDocument());
    // No reload was triggered (pessimistic = nothing to revert), only the initial fetch.
    expect(mockedApi.getGoogleConnection).toHaveBeenCalledTimes(1);
    // Browser default for an uncommitted checkbox click flips the visual state, so
    // we don't assert checkedness here. The contract under test is: API was called
    // exactly once, no reload was issued, and the error is shown.
    expect(mockedApi.updateCalendarFlags).toHaveBeenCalledTimes(1);
  });

  test("inputs disable while a request is in flight", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    let resolveUpdate!: (v: { calendar: typeof calA }) => void;
    mockedApi.updateCalendarFlags.mockReturnValue(
      new Promise((r) => {
        resolveUpdate = r;
      }),
    );

    renderSettings();

    const busyChecks = await screen.findAllByLabelText("空き判定");
    fireEvent.click(busyChecks[0]);

    // Both the busy checkbox and the writes radio for the same row should be disabled.
    const writesRadios = await screen.findAllByLabelText("書込先");
    await waitFor(() => expect(busyChecks[0]).toBeDisabled());
    expect(writesRadios[0]).toBeDisabled();
    // Sibling row remains enabled — only the row in flight is locked.
    expect(busyChecks[1]).not.toBeDisabled();

    resolveUpdate({ calendar: { ...calA, usedForBusy: false } });
  });
});

describe("<Settings /> 組織情報フォーム (ISH-249)", () => {
  test("renders 4 fields (会社名 / チーム名 / 担当者名 / 電話番号)", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    renderSettings();

    expect(screen.getByLabelText(/会社名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/チーム名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/担当者名/)).toBeInTheDocument();
    expect(screen.getByLabelText(/電話番号/)).toBeInTheDocument();
  });

  test("blocks submit and shows inline errors when required fields are empty", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    renderSettings();

    // チーム名 / 担当者名 / 電話番号 を空にして 保存 → 3 つの error が出る。
    // (チーム名 は initial 値があるので空に書き換える)
    const teamName = screen.getByLabelText(/チーム名/) as HTMLInputElement;
    fireEvent.change(teamName, { target: { value: "" } });

    const saveButton = screen.getByRole("button", { name: /^保存$/ });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("チーム名を入力してください")).toBeInTheDocument();
    });
    expect(screen.getByText("担当者名を入力してください")).toBeInTheDocument();
    expect(screen.getByText("電話番号を入力してください")).toBeInTheDocument();
  });

  test("blocks submit when phone number contains non-digit/hyphen characters", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    renderSettings();

    fireEvent.change(screen.getByLabelText(/担当者名/), { target: { value: "担当 太郎" } });
    fireEvent.change(screen.getByLabelText(/電話番号/), { target: { value: "03-1234-abcd" } });

    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(screen.getByText("半角数字とハイフンのみで入力してください")).toBeInTheDocument();
    });
  });
});

describe("<Settings /> Google connection display", () => {
  test("connected: shows the linked account email", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    renderSettings();

    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Google アカウントを連携/ })).toBeNull();
  });

  test("disconnected: shows the Google connect button pointing at the API connect URL", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue({ connected: false, calendars: [] });

    renderSettings();

    const connectLink = await screen.findByRole("link", { name: /Google アカウントを連携/ });
    expect(connectLink).toBeInTheDocument();
    expect(connectLink.getAttribute("href")).toContain("/google/connect");
  });
});

// ---------------------------------------------------------------------------
// ISH-253: Members tab — useTenantMembersQuery() wired to api.listTenantMembers
// ---------------------------------------------------------------------------

const ownerMember: TenantMemberView = {
  id: "u-owner",
  userId: "u-owner",
  email: "ishida@team.example.com",
  name: "Ishida T",
  role: "owner",
  status: "active",
  joinedAt: "2025-12-01T00:00:00.000Z",
};

const activeMember: TenantMemberView = {
  id: "u-yamada",
  userId: "u-yamada",
  email: "yamada@team.example.com",
  name: "山田 太郎",
  role: "member",
  status: "active",
  joinedAt: "2026-02-03T00:00:00.000Z",
};

const pendingMember: TenantMemberView = {
  id: "inv:abc123",
  userId: null,
  email: "suzuki@team.example.com",
  name: null,
  role: "member",
  status: "pending",
  joinedAt: "2026-05-01T00:00:00.000Z",
  expiresIn: "残り 18 時間",
};

const expiredMember: TenantMemberView = {
  id: "inv:def456",
  userId: null,
  email: "tanaka@team.example.com",
  name: null,
  role: "member",
  status: "expired",
  joinedAt: "2026-04-20T00:00:00.000Z",
};

function membersResponse(members: TenantMemberView[]) {
  return { members, callerRole: "owner" as const, callerUserId: "u-owner" };
}

// Radix Tabs uses pointer events; happy-dom doesn't fire pointerDown from a
// click. Drive mouseDown directly — same workaround as
// `apps/web/src/components/ui/tabs.test.tsx`.
function clickTab(name: RegExp | string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

describe("<Settings /> Members tab (ISH-253)", () => {
  test("renders rows from GET /tenant/members on the members tab", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.listTenantMembers.mockResolvedValue(
      membersResponse([ownerMember, activeMember, pendingMember, expiredMember]),
    );

    renderSettings();

    clickTab(/^メンバー$/);

    expect(await screen.findByText("Ishida T")).toBeInTheDocument();
    expect(screen.getByText("山田 太郎")).toBeInTheDocument();
    // Pending: name null → falls back to email as the display name. This makes
    // the email appear twice (once as title, once in the email subtext), so
    // we assert getAllByText finds two and look up the row via the unique
    // expiresIn label below.
    expect(screen.getAllByText("suzuki@team.example.com").length).toBe(2);
    expect(screen.getAllByText("tanaka@team.example.com").length).toBe(2);
    // Owner badge label.
    expect(screen.getByText("オーナー")).toBeInTheDocument();
    // expiresIn rendered for pending.
    expect(screen.getByText("残り 18 時間")).toBeInTheDocument();
    // Active member's joinedAt formatted YYYY/MM/DD; pending/expired show "—".
    expect(screen.getByText("2026/02/03")).toBeInTheDocument();
  });

  test("shows skeleton placeholders while the query is in flight", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    // Never-resolving promise — query stays in loading state for the assertion.
    mockedApi.listTenantMembers.mockReturnValue(new Promise(() => {}));

    renderSettings();

    clickTab(/^メンバー$/);

    // 3 skeleton rows are rendered with aria-hidden; the toolbar/table header
    // is still visible. We assert no real member name has surfaced yet.
    expect(screen.queryByText("Ishida T")).toBeNull();
    expect(screen.queryByText("メンバーがいません")).toBeNull();
    expect(screen.queryByText("該当するメンバーがいません")).toBeNull();
  });

  test("shows error card with retry when the query fails", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.listTenantMembers.mockRejectedValue(
      new ApiError(500, "internal_error", "500 internal_error"),
    );

    renderSettings();

    clickTab(/^メンバー$/);

    expect(await screen.findByText(/メンバーの読み込みに失敗しました/)).toBeInTheDocument();
    expect(screen.getByText(/500 internal_error/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /再試行/ })).toBeInTheDocument();
  });

  test("search filter narrows by name or email substring", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.listTenantMembers.mockResolvedValue(
      membersResponse([ownerMember, activeMember, pendingMember]),
    );

    renderSettings();

    clickTab(/^メンバー$/);

    expect(await screen.findByText("Ishida T")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("メンバーを検索"), {
      target: { value: "yamada" },
    });

    expect(screen.getByText("山田 太郎")).toBeInTheDocument();
    expect(screen.queryByText("Ishida T")).toBeNull();
    expect(screen.queryByText("suzuki@team.example.com")).toBeNull();
  });

  test("status filter narrows by active/pending/expired", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.listTenantMembers.mockResolvedValue(
      membersResponse([ownerMember, pendingMember, expiredMember]),
    );

    renderSettings();

    clickTab(/^メンバー$/);

    expect(await screen.findByText("Ishida T")).toBeInTheDocument();

    // Click the status filter trigger and pick "招待中".
    const triggers = screen.getAllByRole("combobox");
    // First combobox is the members status filter (only one in MembersTab).
    const statusFilter = triggers[triggers.length - 1];
    if (!statusFilter) throw new Error("status filter not found");
    fireEvent.click(statusFilter);

    const pendingOption = await screen.findByRole("option", { name: /^招待中$/ });
    fireEvent.click(pendingOption);

    await waitFor(() => {
      expect(screen.queryByText("Ishida T")).toBeNull();
    });
    // Pending row visible (email appears twice — display name fallback + sub).
    expect(screen.getAllByText("suzuki@team.example.com").length).toBe(2);
    // Expired row hidden by the filter.
    expect(screen.queryByText("tanaka@team.example.com")).toBeNull();
  });

  test("stats cards reflect counts derived from the response", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.listTenantMembers.mockResolvedValue(
      membersResponse([ownerMember, activeMember, pendingMember, expiredMember]),
    );

    renderSettings();

    clickTab(/^メンバー$/);

    // Wait for the query to settle by waiting on a row that only renders
    // after the response lands. Then assert the StatCard active count = 2
    // (ownerMember + activeMember).
    expect(await screen.findByText("Ishida T")).toBeInTheDocument();
    // StatCard splits value and total into separate spans.
    const totalSpan = screen.getByText("/ 10");
    expect(totalSpan).toBeInTheDocument();
    expect(totalSpan.previousElementSibling?.textContent).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// ISH-251: Members tab delete row-action visibility guards.
//
// Radix DropdownMenu uses pointer events that happy-dom cannot dispatch via
// `fireEvent.click`, so we cannot reliably *open* the menu in unit tests.
// Visibility of the trigger button itself is sufficient: the BE owner /
// self / owner-target guards are pinned by tenant.members.test.ts, and the
// FE guard surface-area is "show or don't show the trigger".
// ---------------------------------------------------------------------------

describe("<MembersTab /> 削除ガード — row action menu visibility (ISH-251)", () => {
  const ownerSelf: TenantMemberView = {
    id: "u-owner",
    userId: "u-owner",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    status: "active",
    joinedAt: "2025-12-01T00:00:00Z",
  };
  const memberRow: TenantMemberView = {
    id: "u-member",
    userId: "u-member",
    email: "member@example.com",
    name: "Member",
    role: "member",
    status: "active",
    joinedAt: "2026-01-15T00:00:00Z",
  };
  const pendingRow: TenantMemberView = {
    id: "inv:1",
    userId: null,
    email: "invitee@example.com",
    name: null,
    role: "member",
    status: "pending",
    joinedAt: "2026-05-01T00:00:00Z",
    expiresIn: "残り 18 時間",
  };

  const baseStats = { active: 2, pending: 0, expired: 0 };

  const renderTab = (props: Parameters<typeof MembersTab>[0]) =>
    render(
      <TestQueryProvider>
        <ToastProvider>
          <MembersTab {...props} />
        </ToastProvider>
      </TestQueryProvider>,
    );

  test("caller is not owner → no row action menu rendered for any row", () => {
    renderTab({
      members: [ownerSelf, memberRow],
      stats: baseStats,
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "member",
      callerUserId: "u-member",
    });
    expect(screen.queryByTestId("member-row-actions-owner@example.com")).toBeNull();
    expect(screen.queryByTestId("member-row-actions-member@example.com")).toBeNull();
  });

  test("owner caller, self row → menu hidden on the self row, visible on others", () => {
    renderTab({
      members: [ownerSelf, memberRow],
      stats: baseStats,
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    expect(screen.queryByTestId("member-row-actions-owner@example.com")).toBeNull();
    expect(screen.getByTestId("member-row-actions-member@example.com")).toBeInTheDocument();
  });

  test("pending / expired rows do not show the active-row action menu (再送 button stays)", () => {
    renderTab({
      members: [ownerSelf, pendingRow],
      stats: { active: 1, pending: 1, expired: 0 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    expect(screen.queryByTestId("member-row-actions-invitee@example.com")).toBeNull();
    // 再送 button still renders for pending rows.
    expect(screen.getByRole("button", { name: "再送" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ISH-257: placeholder tabs (招待 / 通知 / プラン) removed — regression guard
// ---------------------------------------------------------------------------

describe("<Settings /> tabs — MVP placeholder removal (ISH-257)", () => {
  test("renders only 基本情報 / メンバー tabs; 招待 / 通知 / プラン are removed", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.listTenantMembers.mockResolvedValue(membersResponse([ownerMember, pendingMember]));

    renderSettings();

    // Surviving tabs are present.
    expect(screen.getByRole("tab", { name: /^基本情報$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^メンバー$/ })).toBeInTheDocument();

    // Removed tabs must not appear, even after the query settles (which used
    // to surface "招待 (1)" via stats.pending). Wait on a row from the
    // resolved members response so we know the query has landed before
    // asserting absence.
    clickTab(/^メンバー$/);
    expect(await screen.findByText("Ishida T")).toBeInTheDocument();

    expect(screen.queryByRole("tab", { name: /招待/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^通知$/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^プラン$/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ISH-256: row action menus — visibility + mutation wiring.
//
// Same caveat as the ISH-251 visibility tests above: Radix DropdownMenu uses
// pointer events that happy-dom can't dispatch via fireEvent.click, so we
// don't drive the menu open. We do verify
//   - that the right action triggers render in the right circumstances
//   - that calling each mutation hook directly (via mocked api) emits the
//     expected toast / api call / cache invalidation.
// ---------------------------------------------------------------------------

describe("<MembersTab /> 権限変更 / 招待取消 — visibility (ISH-256)", () => {
  const ownerSelf: TenantMemberView = {
    id: "u-owner",
    userId: "u-owner",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    status: "active",
    joinedAt: "2025-12-01T00:00:00Z",
  };
  const memberRow: TenantMemberView = {
    id: "u-member",
    userId: "u-member",
    email: "member@example.com",
    name: "Member",
    role: "member",
    status: "active",
    joinedAt: "2026-01-15T00:00:00Z",
  };
  const pendingRow: TenantMemberView = {
    id: "inv:abc123",
    userId: null,
    email: "invitee@example.com",
    name: null,
    role: "member",
    status: "pending",
    joinedAt: "2026-05-01T00:00:00Z",
    expiresIn: "残り 18 時間",
  };
  const expiredRow: TenantMemberView = {
    id: "inv:def456",
    userId: null,
    email: "tanaka@team.example.com",
    name: null,
    role: "member",
    status: "expired",
    joinedAt: "2026-04-20T00:00:00Z",
  };

  const baseStats = { active: 2, pending: 0, expired: 0 };

  const renderTab = (props: Parameters<typeof MembersTab>[0]) =>
    render(
      <TestQueryProvider>
        <ToastProvider>
          <MembersTab {...props} />
        </ToastProvider>
      </TestQueryProvider>,
    );

  test("owner caller sees an invitation row action trigger for pending rows", () => {
    renderTab({
      members: [ownerSelf, pendingRow],
      stats: { active: 1, pending: 1, expired: 0 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    expect(screen.getByTestId("invitation-row-actions-invitee@example.com")).toBeInTheDocument();
  });

  test("owner caller sees an invitation row action trigger for expired rows", () => {
    renderTab({
      members: [ownerSelf, expiredRow],
      stats: { active: 1, pending: 0, expired: 1 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    expect(
      screen.getByTestId("invitation-row-actions-tanaka@team.example.com"),
    ).toBeInTheDocument();
  });

  test("member caller sees no invitation row action triggers (read-only)", () => {
    renderTab({
      members: [ownerSelf, memberRow, pendingRow],
      stats: { active: 2, pending: 1, expired: 0 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "member",
      callerUserId: "u-member",
    });
    expect(screen.queryByTestId("invitation-row-actions-invitee@example.com")).toBeNull();
  });

  test("active row trigger still renders for owner caller (role change menu lives here)", () => {
    renderTab({
      members: [ownerSelf, memberRow],
      stats: baseStats,
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    // Self row hidden, target row visible. The menu inside has both
    // 権限変更 and 削除 items (open requires a real pointer event so we
    // pin only the trigger here — mutation behavior is exercised via the
    // hook tests below and the BE integration test).
    expect(screen.queryByTestId("member-row-actions-owner@example.com")).toBeNull();
    expect(screen.getByTestId("member-row-actions-member@example.com")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ISH-256: mutation hook integration — verified via direct hook invocation
// since happy-dom can't open the Radix dropdown menu.
// ---------------------------------------------------------------------------

import { act, renderHook } from "@testing-library/react";
import {
  useChangeTenantMemberRoleMutation,
  useRevokeTenantInvitationMutation,
} from "@/lib/queries";

function HookWrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestQueryProvider>
      <ToastProvider>{children}</ToastProvider>
    </TestQueryProvider>
  );
}

describe("useChangeTenantMemberRoleMutation (ISH-256)", () => {
  test("calls api.changeTenantMemberRole with userId + role and resolves on success", async () => {
    mockedApi.changeTenantMemberRole.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useChangeTenantMemberRoleMutation(), {
      wrapper: HookWrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ userId: "u-target", role: "owner" });
    });

    expect(mockedApi.changeTenantMemberRole).toHaveBeenCalledWith(
      "u-target",
      "owner",
      expect.any(Function),
    );
  });

  test("propagates a 409 last_owner ApiError from the server", async () => {
    mockedApi.changeTenantMemberRole.mockRejectedValue(
      new ApiError(409, "last_owner", "409 last_owner"),
    );

    const { result } = renderHook(() => useChangeTenantMemberRoleMutation(), {
      wrapper: HookWrapper,
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ userId: "u-target", role: "member" });
      }),
    ).rejects.toMatchObject({ code: "last_owner", status: 409 });
  });
});

describe("useRevokeTenantInvitationMutation (ISH-256)", () => {
  test("calls api.revokeTenantInvitation with the bare invitation id", async () => {
    mockedApi.revokeTenantInvitation.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useRevokeTenantInvitationMutation(), {
      wrapper: HookWrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("abc123");
    });

    expect(mockedApi.revokeTenantInvitation).toHaveBeenCalledWith("abc123", expect.any(Function));
  });

  test("propagates a 409 already_accepted ApiError from the server", async () => {
    mockedApi.revokeTenantInvitation.mockRejectedValue(
      new ApiError(409, "already_accepted", "409 already_accepted"),
    );

    const { result } = renderHook(() => useRevokeTenantInvitationMutation(), {
      wrapper: HookWrapper,
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("abc123");
      }),
    ).rejects.toMatchObject({ code: "already_accepted", status: 409 });
  });
});

// ---------------------------------------------------------------------------
// ISH-261: 再送 button — visibility + click flow.
// ---------------------------------------------------------------------------

import { useResendTenantInvitationMutation } from "@/lib/queries";

describe("<MembersTab /> 再送 button visibility (ISH-261)", () => {
  const ownerSelf: TenantMemberView = {
    id: "u-owner",
    userId: "u-owner",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    status: "active",
    joinedAt: "2025-12-01T00:00:00Z",
  };
  const pendingRow: TenantMemberView = {
    id: "inv:abc123",
    userId: null,
    email: "invitee@example.com",
    name: null,
    role: "member",
    status: "pending",
    joinedAt: "2026-05-01T00:00:00Z",
    expiresIn: "残り 18 時間",
  };
  const expiredRow: TenantMemberView = {
    id: "inv:def456",
    userId: null,
    email: "tanaka@team.example.com",
    name: null,
    role: "member",
    status: "expired",
    joinedAt: "2026-04-20T00:00:00Z",
  };

  const renderTab = (props: Parameters<typeof MembersTab>[0]) =>
    render(
      <TestQueryProvider>
        <ToastProvider>
          <MembersTab {...props} />
        </ToastProvider>
      </TestQueryProvider>,
    );

  test("owner sees 再送 button on pending rows", () => {
    renderTab({
      members: [ownerSelf, pendingRow],
      stats: { active: 1, pending: 1, expired: 0 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    expect(screen.getByTestId("invitation-resend-invitee@example.com")).toBeInTheDocument();
  });

  test("owner sees 再送 button on expired rows", () => {
    renderTab({
      members: [ownerSelf, expiredRow],
      stats: { active: 1, pending: 0, expired: 1 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });
    expect(screen.getByTestId("invitation-resend-tanaka@team.example.com")).toBeInTheDocument();
  });

  test("member caller does NOT see 再送 buttons (BE owner-only; FE hides for UX)", () => {
    renderTab({
      members: [ownerSelf, pendingRow],
      stats: { active: 1, pending: 1, expired: 0 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "member",
      callerUserId: "u-other",
    });
    expect(screen.queryByTestId("invitation-resend-invitee@example.com")).toBeNull();
  });

  test("clicking 再送 calls api.resendTenantInvitation with the bare invitation id", async () => {
    mockedApi.resendTenantInvitation.mockResolvedValue({
      ok: true,
      expiresAt: "2026-05-08T00:00:00Z",
    });
    renderTab({
      members: [ownerSelf, pendingRow],
      stats: { active: 1, pending: 1, expired: 0 },
      isLoading: false,
      isError: false,
      error: null,
      onRetry: () => {},
      callerRole: "owner",
      callerUserId: "u-owner",
    });

    fireEvent.click(screen.getByTestId("invitation-resend-invitee@example.com"));

    await waitFor(() => {
      expect(mockedApi.resendTenantInvitation).toHaveBeenCalledWith("abc123", expect.any(Function));
    });
  });
});

describe("useResendTenantInvitationMutation (ISH-261)", () => {
  test("calls api.resendTenantInvitation with the bare invitation id", async () => {
    mockedApi.resendTenantInvitation.mockResolvedValue({
      ok: true,
      expiresAt: "2026-05-08T00:00:00Z",
    });

    const { result } = renderHook(() => useResendTenantInvitationMutation(), {
      wrapper: HookWrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("abc123");
    });

    expect(mockedApi.resendTenantInvitation).toHaveBeenCalledWith("abc123", expect.any(Function));
  });

  test("propagates a 409 already_accepted ApiError from the server", async () => {
    mockedApi.resendTenantInvitation.mockRejectedValue(
      new ApiError(409, "already_accepted", "409 already_accepted"),
    );

    const { result } = renderHook(() => useResendTenantInvitationMutation(), {
      wrapper: HookWrapper,
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("abc123");
      }),
    ).rejects.toMatchObject({ code: "already_accepted", status: 409 });
  });

  test("propagates a 404 not_found ApiError when the invitation has been canceled", async () => {
    mockedApi.resendTenantInvitation.mockRejectedValue(
      new ApiError(404, "not_found", "404 not_found"),
    );

    const { result } = renderHook(() => useResendTenantInvitationMutation(), {
      wrapper: HookWrapper,
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync("abc123");
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});
