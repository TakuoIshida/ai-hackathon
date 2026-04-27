import { httpFetch } from "./http";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export type PublicLink = {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  timeZone: string;
};

export type PublicSlot = { start: string; end: string };

export type SlotsResponse = {
  durationMinutes: number;
  timeZone: string;
  slots: PublicSlot[];
};

export type ConfirmedBooking = {
  id: string;
  startAt: string;
  endAt: string;
  guestName: string;
  guestEmail: string;
  status: string;
  meetUrl: string | null;
  cancellationToken: string;
};

export class PublicApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await httpFetch(`${API_URL}${path}`);
  if (!res.ok) {
    let code = "request_failed";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = body.error;
    } catch {}
    throw new PublicApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export async function fetchPublicLink(slug: string): Promise<PublicLink> {
  return getJson<PublicLink>(`/public/links/${encodeURIComponent(slug)}`);
}

export async function fetchPublicSlots(
  slug: string,
  fromIso: string,
  toIso: string,
): Promise<SlotsResponse> {
  const params = new URLSearchParams({ from: fromIso, to: toIso });
  return getJson<SlotsResponse>(`/public/links/${encodeURIComponent(slug)}/slots?${params}`);
}

export type BookingRequestBody = {
  startAt: string;
  guestName: string;
  guestEmail: string;
  guestNote?: string;
  guestTimeZone?: string;
};

export async function postPublicBooking(
  slug: string,
  body: BookingRequestBody,
): Promise<ConfirmedBooking> {
  const res = await httpFetch(`${API_URL}/public/links/${encodeURIComponent(slug)}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = "request_failed";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) code = data.error;
    } catch {}
    throw new PublicApiError(res.status, code);
  }
  const data = (await res.json()) as { booking: ConfirmedBooking };
  return data.booking;
}
