import type { BookingSummary, GoogleConnection, LinkDetail, LinkInput, LinkSummary } from "./types";

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
  const res = await fetch(`${API_URL}${path}`, {
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
};

export const googleConnectUrl = `${API_URL}/google/connect`;
