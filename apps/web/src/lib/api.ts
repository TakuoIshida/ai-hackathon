import { httpFetch } from "./http";
// httpFetch is also re-used directly by exportBookingsCsv (binary blob path).
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

// ISH-268: GET /bookings query params + response shape.
export type ListBookingsParams = {
  q?: string;
  status?: "all" | "confirmed" | "canceled";
  page?: number;
  pageSize?: number;
};

export type ListBookingsResponse = {
  bookings: BookingSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// ISH-271: CSV export query params. Same shape as `ListBookingsParams` minus
// pagination (the server returns every matching row in one shot).
export type ExportBookingsCsvParams = {
  q?: string;
  status?: "all" | "confirmed" | "canceled";
};

function buildExportCsvQuery(params: ExportBookingsCsvParams | undefined): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  if (params.q && params.q.length > 0) usp.set("q", params.q);
  if (params.status && params.status !== "all") usp.set("status", params.status);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

function buildBookingsQuery(params: ListBookingsParams | undefined): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  // Skip empty-string `q` so the server's `q.trim().length > 0` short-circuit
  // is symmetric with what the FE shows in the input. Sending `?q=` would
  // serialize to a literal "" on the server and trip nothing useful.
  if (params.q && params.q.length > 0) usp.set("q", params.q);
  if (params.status && params.status !== "all") usp.set("status", params.status);
  if (params.page !== undefined) usp.set("page", String(params.page));
  if (params.pageSize !== undefined) usp.set("pageSize", String(params.pageSize));
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

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

  // ISH-268: server-side search / status filter / pagination. The previous
  // signature `(getToken)` is preserved by making `params` optional — when
  // omitted the server still defaults to page=1, pageSize=25, status=all.
  listBookings: (params: ListBookingsParams | undefined, getToken: AuthTokenGetter) =>
    request<ListBookingsResponse>(`/bookings${buildBookingsQuery(params)}`, { getToken }),

  // ISH-271: CSV export. Same `q` / `status` filters as `listBookings` (no
  // pagination). Returns a Blob so the caller can trigger a download via
  // URL.createObjectURL + an anchor click without inspecting the body.
  // Uses `httpFetch` directly (instead of the JSON-centric `request` helper)
  // because the response body is `text/csv`, not JSON, and we need to
  // surface the binary stream to the FE intact.
  exportBookingsCsv: async (
    params: ExportBookingsCsvParams | undefined,
    getToken: AuthTokenGetter,
  ): Promise<Blob> => {
    const headers = new Headers();
    const token = await getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await httpFetch(`${API_URL}/bookings/export.csv${buildExportCsvQuery(params)}`, {
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      let body: { error?: string } = {};
      try {
        body = (await res.json()) as { error?: string };
      } catch {
        // not JSON — server responded with text/html or empty body
      }
      throw new ApiError(
        res.status,
        body.error ?? "request_failed",
        `${res.status} ${res.statusText}`,
      );
    }
    return await res.blob();
  },

  // ISH-254: dedicated detail endpoint. The detail screen calls this instead
  // of paging the entire booking list and filtering client-side.
  getBooking: (id: string, getToken: AuthTokenGetter) =>
    request<{ booking: BookingSummary }>(`/bookings/${id}`, { getToken }),

  cancelBooking: (id: string, getToken: AuthTokenGetter) =>
    request<{ ok: boolean; alreadyCanceled?: boolean }>(`/bookings/${id}`, {
      method: "DELETE",
      getToken,
    }),

  // ISH-270: owner-side reschedule. Body carries the new (startAt, endAt)
  // ISO strings. Server re-checks ownership / state / availability and may
  // respond 422 (`not_reschedulable` / `availability_violation`) or 409
  // (`slot_already_booked`). On 200 the updated BookingSummary projection
  // comes back so the FE can refresh detail/list caches in one round trip.
  rescheduleBooking: (
    id: string,
    body: { startAt: string; endAt: string },
    getToken: AuthTokenGetter,
  ) =>
    request<{ booking: BookingSummary }>(`/bookings/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify(body),
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
  // ISH-260: response now includes the invited `role` so the Welcome card
  // can show "オーナーとして / メンバーとして 招待されています".
  getInvitation: (token: string) =>
    request<{
      workspace: { name: string };
      expired: boolean;
      role: MembershipRole;
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

  // ISH-256: change a tenant member's role (owner ↔ member). Owner-only on the
  // server. Returns `{ ok: true }` (or `{ ok: true, noop: true }` when the
  // requested role equals the current role). 409 last_owner blocks demoting
  // the only remaining owner.
  changeTenantMemberRole: (userId: string, role: MembershipRole, getToken: AuthTokenGetter) =>
    request<{ ok: true; noop?: boolean }>(`/tenant/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
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

  // ISH-256: revoke a still-open tenant invitation (owner only). Once an
  // invitation has been accepted the row is preserved and cannot be
  // revoked through this endpoint. 200 ok | 401 | 403 | 404 | 409 already_accepted.
  revokeTenantInvitation: (invitationId: string, getToken: AuthTokenGetter) =>
    request<{ ok: true }>(`/tenant/invitations/${encodeURIComponent(invitationId)}`, {
      method: "DELETE",
      getToken,
    }),

  // ISH-261: resend a still-open tenant invitation (owner only). Bumps the
  // server-side `expiresAt` by 24h and re-delivers the invitation email
  // through the BE's mail port (best-effort send).
  // 200 { ok: true, expiresAt: string } | 401 | 403 | 404 | 409 already_accepted.
  resendTenantInvitation: (invitationId: string, getToken: AuthTokenGetter) =>
    request<{ ok: true; expiresAt: string }>(
      `/tenant/invitations/${encodeURIComponent(invitationId)}/resend`,
      {
        method: "POST",
        getToken,
      },
    ),
};

export type { InvitationSummary };

export const googleConnectUrl = `${API_URL}/google/connect`;
