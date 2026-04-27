import { httpFetch } from "./http";
import type {
  AcceptedInvitationWorkspace,
  BookingSummary,
  GoogleCalendarSummary,
  GoogleConnection,
  InvitationSummary,
  LinkDetail,
  LinkInput,
  LinkSummary,
  MembershipRole,
  WorkspaceDetail,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceSummary,
} from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AuthTokenGetter = () => Promise<string | null>;

async function request<T>(
  path: string,
  init: RequestInit & { getToken?: AuthTokenGetter } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.getToken) {
    const token = await init.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await httpFetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    let body: { error?: string } = {};
    try {
      body = (await res.json()) as { error?: string };
    } catch {
      // not JSON
    }
    throw new ApiError(
      res.status,
      body.error ?? "request_failed",
      `${res.status} ${res.statusText}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listLinks: (getToken: AuthTokenGetter) =>
    request<{ links: LinkSummary[] }>("/links", { getToken }),

  getLink: (id: string, getToken: AuthTokenGetter) =>
    request<{ link: LinkDetail }>(`/links/${id}`, { getToken }),

  createLink: (input: LinkInput, getToken: AuthTokenGetter) =>
    request<{ link: LinkDetail }>("/links", {
      method: "POST",
      body: JSON.stringify(input),
      getToken,
    }),

  updateLink: (id: string, input: Partial<LinkInput>, getToken: AuthTokenGetter) =>
    request<{ link: LinkDetail }>(`/links/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
      getToken,
    }),

  deleteLink: (id: string, getToken: AuthTokenGetter) =>
    request<void>(`/links/${id}`, { method: "DELETE", getToken }),

  checkSlugAvailable: (slug: string, getToken: AuthTokenGetter) =>
    request<{ slug: string; available: boolean }>(
      `/links/slug-available?slug=${encodeURIComponent(slug)}`,
      { getToken },
    ),

  listBookings: (getToken: AuthTokenGetter) =>
    request<{ bookings: BookingSummary[] }>("/bookings", { getToken }),

  cancelBooking: (id: string, getToken: AuthTokenGetter) =>
    request<{ ok: boolean; alreadyCanceled?: boolean }>(`/bookings/${id}`, {
      method: "DELETE",
      getToken,
    }),

  getGoogleConnection: (getToken: AuthTokenGetter) =>
    request<GoogleConnection>("/google/calendars", { getToken }),

  disconnectGoogle: (getToken: AuthTokenGetter) =>
    request<{ ok: boolean }>("/google/disconnect", { method: "POST", getToken }),

  updateCalendarFlags: (
    id: string,
    patch: { usedForBusy?: boolean; usedForWrites?: boolean },
    getToken: AuthTokenGetter,
  ) =>
    request<{ calendar: GoogleCalendarSummary }>(`/google/calendars/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      getToken,
    }),

  // ISH-107: workspaces.
  listWorkspaces: (getToken: AuthTokenGetter) =>
    request<{ workspaces: WorkspaceSummary[] }>("/workspaces", { getToken }),

  createWorkspace: (input: { name: string; slug: string }, getToken: AuthTokenGetter) =>
    request<{ workspace: WorkspaceDetail }>("/workspaces", {
      method: "POST",
      body: JSON.stringify(input),
      getToken,
    }),

  getWorkspace: (id: string, getToken: AuthTokenGetter) =>
    request<{ workspace: WorkspaceDetail }>(`/workspaces/${id}`, { getToken }),

  // ISH-110: members.
  listMembers: (workspaceId: string, getToken: AuthTokenGetter) =>
    request<{ members: WorkspaceMember[]; callerRole: WorkspaceRole; callerUserId: string }>(
      `/workspaces/${workspaceId}/members`,
      { getToken },
    ),

  removeMember: (workspaceId: string, userId: string, getToken: AuthTokenGetter) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${userId}`, {
      method: "DELETE",
      getToken,
    }),

  // ISH-109: invitation acceptance.
  // GET is intentionally unauthenticated — the unauth landing page calls it
  // before the user signs in. Pass NO `getToken` so we don't attach a header.
  getInvitation: (token: string) =>
    request<{
      workspace: { name: string; slug: string };
      email: string;
      expired: boolean;
    }>(`/invitations/${encodeURIComponent(token)}`),

  acceptInvitation: (token: string, getToken: AuthTokenGetter) =>
    request<{ workspace: AcceptedInvitationWorkspace }>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: "POST", getToken },
    ),

  // ISH-111: change a member's role within a workspace. Owner-only on the
  // server. Returns `{ ok: true }` (or `{ ok: true, noop: true }` if the new
  // role equals the current role).
  changeMemberRole: (
    workspaceId: string,
    userId: string,
    role: MembershipRole,
    getToken: AuthTokenGetter,
  ) =>
    request<{ ok: true; noop?: boolean }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }), getToken },
    ),
};

export type { InvitationSummary };

export const googleConnectUrl = `${API_URL}/google/connect`;
