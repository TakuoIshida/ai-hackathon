import { type FetchLike, httpFetch } from "@/lib/http";
import type { Interval } from "../scheduling/types";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type CalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string;
};

type RawCalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
};

type RawCalendarListResponse = {
  items?: RawCalendarListEntry[];
};

export async function listCalendars(
  accessToken: string,
  fetchImpl: FetchLike = httpFetch,
): Promise<CalendarListItem[]> {
  const res = await fetchImpl(`${CALENDAR_API}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`calendarList ${res.status}: ${text}`);
  }
  const data = (await res.json()) as RawCalendarListResponse;
  return (data.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary === true,
    timeZone: c.timeZone ?? "UTC",
  }));
}

type RawFreeBusyResponse = {
  calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
};

export async function queryFreeBusy(input: {
  accessToken: string;
  calendarIds: ReadonlyArray<string>;
  rangeStart: number;
  rangeEnd: number;
  fetchImpl?: FetchLike;
}): Promise<Interval[]> {
  const { accessToken, calendarIds, rangeStart, rangeEnd, fetchImpl = httpFetch } = input;
  if (calendarIds.length === 0) return [];
  const res = await fetchImpl(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: new Date(rangeStart).toISOString(),
      timeMax: new Date(rangeEnd).toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`freeBusy ${res.status}: ${text}`);
  }
  const data = (await res.json()) as RawFreeBusyResponse;
  const intervals: Interval[] = [];
  for (const id of calendarIds) {
    const busy = data.calendars?.[id]?.busy ?? [];
    for (const b of busy) {
      const start = Date.parse(b.start);
      const end = Date.parse(b.end);
      if (Number.isFinite(start) && Number.isFinite(end) && start < end) {
        intervals.push({ start, end });
      }
    }
  }
  return intervals;
}

export type EventCreateInput = {
  accessToken: string;
  calendarId: string;
  startMs: number;
  endMs: number;
  timeZone: string;
  title: string;
  description?: string;
  attendees: ReadonlyArray<{ email: string; displayName?: string }>;
  generateMeetUrl?: boolean;
  fetchImpl?: FetchLike;
};

export type CreatedEvent = {
  id: string;
  meetUrl?: string;
  htmlLink?: string;
};

type RawEvent = {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
};

function pickMeetUrl(raw: RawEvent): string | undefined {
  if (raw.hangoutLink) return raw.hangoutLink;
  const entry = raw.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  return entry?.uri;
}

export async function createEvent(input: EventCreateInput): Promise<CreatedEvent> {
  const {
    accessToken,
    calendarId,
    startMs,
    endMs,
    timeZone,
    title,
    description,
    attendees,
    generateMeetUrl = true,
    fetchImpl = httpFetch,
  } = input;

  const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
  if (generateMeetUrl) url.searchParams.set("conferenceDataVersion", "1");
  url.searchParams.set("sendUpdates", "all");

  const body: Record<string, unknown> = {
    summary: title,
    description,
    start: { dateTime: new Date(startMs).toISOString(), timeZone },
    end: { dateTime: new Date(endMs).toISOString(), timeZone },
    attendees: attendees.map((a) => ({ email: a.email, displayName: a.displayName })),
  };

  if (generateMeetUrl) {
    body.conferenceData = {
      createRequest: {
        requestId: `req-${startMs}-${calendarId}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const res = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`events.insert ${res.status}: ${text}`);
  }
  const raw = (await res.json()) as RawEvent;
  return { id: raw.id, meetUrl: pickMeetUrl(raw), htmlLink: raw.htmlLink };
}

export async function deleteEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const { accessToken, calendarId, eventId, fetchImpl = httpFetch } = input;
  const url = new URL(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  url.searchParams.set("sendUpdates", "all");
  const res = await fetchImpl(url.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text();
    throw new Error(`events.delete ${res.status}: ${text}`);
  }
}

// ISH-270: events.patch — used by reschedule to bump start/end on an existing
// Google Calendar event. We send only the time fields (PATCH semantics) so any
// edits the host made to summary / attendees stay intact. `sendUpdates=all` so
// guests receive the calendar update notification.
export type EventPatchInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
  startMs: number;
  endMs: number;
  timeZone: string;
  fetchImpl?: FetchLike;
};

export type PatchedEvent = {
  id: string;
  htmlLink?: string;
};

export async function patchEvent(input: EventPatchInput): Promise<PatchedEvent> {
  const {
    accessToken,
    calendarId,
    eventId,
    startMs,
    endMs,
    timeZone,
    fetchImpl = httpFetch,
  } = input;
  const url = new URL(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  url.searchParams.set("sendUpdates", "all");
  const body = {
    start: { dateTime: new Date(startMs).toISOString(), timeZone },
    end: { dateTime: new Date(endMs).toISOString(), timeZone },
  };
  const res = await fetchImpl(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`events.patch ${res.status}: ${text}`);
  }
  const raw = (await res.json()) as RawEvent;
  return { id: raw.id, htmlLink: raw.htmlLink };
}
