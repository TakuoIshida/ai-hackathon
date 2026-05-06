import { httpFetch } from "./http";
import type {
  BookingSummary,
  GoogleCalendarSummary,
  GoogleConnection,
  InvitationSummary,
  LinkDetail,
  LinkInput,
  LinkSummary,
  MembershipRole,
  TenantMemberView,
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
    const err = new ApiError(
      res.status,
      body.error ?? "request_failed",
      `${res.status} ${res.statusText}`,
    );
    // 401: session expired or token invalid → redirect to sign-in.
    // Skip the redirect when we're already on an unauthenticated path:
    //   - /sign-in / /sign-up: would cause a redirect loop
    //   - /invite/:token: AcceptInvite calls api.getInvitation (unauth GET).
    //     If the backend returns 401 for any reason (regression / misconfig),
    //     we don't want to rip the user away from the invitation landing page.
    // window check guards against SSR / test environments that don't set
    // window.location.replace.
    if (res.status === 401 && typeof window !== "undefined" && window.location?.replace) {
      const pathname = window.location.pathname ?? "";
      const onUnauthPath = pathname.startsWith("/sign-") || pathname.startsWith("/invite/");
      if (!onUnauthPath) {
        window.location.replace("/sign-in");
      }
    }
    throw err;
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

  // ISH-254: dedicated detail endpoint. The detail screen calls this instead
  // of paging the entire booking list and filtering client-side.
  getBooking: (id: string, getToken: AuthTokenGetter) =>
    request<{ booking: BookingSummary }>(`/bookings/${id}`, { getToken }),

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

  // ISH-109 / ISH-179 / ISH-208: invitation preview (GET, no auth).
  // The unauth landing page reads it before the user has signed in.
  // ISH-208: response intentionally omits `email` to prevent invitee
  // enumeration via guessed/stolen tokens. The email match is enforced
  // at POST /accept time (collapsed to 404 per ISH-194).
  getInvitation: (token: string) =>
    request<{
      workspace: { name: string };
      expired: boolean;
    }>(`/invitations/${encodeURIComponent(token)}`),

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

  // ISH-179: onboarding — create a tenant for the authenticated user.
  // 201 { tenantId, name, role } | 409 { error: "already_member" }
  createTenant: (name: string, getToken: AuthTokenGetter) =>
    request<{ tenantId: string; name: string; role: string }>("/onboarding/tenant", {
      method: "POST",
      body: JSON.stringify({ name }),
      getToken,
    }),

  // ISH-179: accept a tenant invitation by token.
  // 201 { tenantId, role } | 404 | 409 | 410
  acceptTenantInvitation: (token: string, getToken: AuthTokenGetter) =>
    request<{ tenantId: string; role: string }>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      { method: "POST", getToken },
    ),

  // ISH-253 / ISH-250: tenant-scoped member listing. Returns active members
  // joined with open invitations (pending / expired). RLS scopes to the
  // caller's tenant — no tenantId in the path.
  listTenantMembers: (getToken: AuthTokenGetter) =>
    request<{ members: TenantMemberView[]; callerRole: WorkspaceRole; callerUserId: string }>(
      "/tenant/members",
      { getToken },
    ),

  // ISH-251: remove a tenant member. Owner-only on the server. Server-side
  // guards: 400 cannot_remove_self / cannot_remove_owner, 403 forbidden,
  // 404 not_found. The FE row-action menu hides for non-owners / self / owner
  // targets so these errors only fire in race conditions.
  removeTenantMember: (userId: string, getToken: AuthTokenGetter) =>
    request<{ ok: true }>(`/tenant/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      getToken,
    }),

  // ISH-239: issue a tenant invitation (owner only). The API accepts one
  // email per request, so the modal POSTs each chip in parallel and
  // aggregates per-email results.
  // 201 { invitationId, token, expiresAt } | 400 | 401 | 403 | 409
  createTenantInvitation: (
    input: { email: string; role: "owner" | "member" },
    getToken: AuthTokenGetter,
  ) =>
    request<{ invitationId: string; token: string; expiresAt: string }>("/tenant/invitations", {
      method: "POST",
      body: JSON.stringify(input),
      getToken,
    }),
};

export type { InvitationSummary };

export const googleConnectUrl = `${API_URL}/google/connect`;
