import { describe, expect, test } from "bun:test";
import { createEvent, deleteEvent, listCalendars, queryFreeBusy } from "./calendar";

type FetchCall = { url: string; init: RequestInit | undefined };

const recordingFetch = (responder: (call: FetchCall) => Response) => {
  const calls: FetchCall[] = [];
  const fakeFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const call = { url, init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return { fetch: fakeFetch, calls };
};

const TOKEN = "ya29.test";

describe("listCalendars", () => {
  test("maps response and detects primary", async () => {
    const { fetch: f, calls } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({
            items: [
              { id: "primary@example.com", summary: "Me", primary: true, timeZone: "Asia/Tokyo" },
              { id: "team@group.calendar.google.com", summary: "Team" },
            ],
          }),
          { status: 200 },
        ),
    );
    const calendars = await listCalendars(TOKEN, f);
    expect(calendars).toEqual([
      { id: "primary@example.com", summary: "Me", primary: true, timeZone: "Asia/Tokyo" },
      { id: "team@group.calendar.google.com", summary: "Team", primary: false, timeZone: "UTC" },
    ]);
    expect(calls[0]?.url).toBe("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    expect((calls[0]?.init?.headers as Record<string, string>)?.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  test("throws on error", async () => {
    const { fetch: f } = recordingFetch(() => new Response("nope", { status: 401 }));
    await expect(listCalendars(TOKEN, f)).rejects.toThrow(/401/);
  });
});

describe("queryFreeBusy", () => {
  test("merges busy across calendars and returns Interval[]", async () => {
    const rangeStart = Date.UTC(2026, 3, 27, 0, 0);
    const rangeEnd = Date.UTC(2026, 3, 28, 0, 0);
    const busy1 = {
      start: new Date(rangeStart + 9 * 3600_000).toISOString(),
      end: new Date(rangeStart + 10 * 3600_000).toISOString(),
    };
    const busy2 = {
      start: new Date(rangeStart + 14 * 3600_000).toISOString(),
      end: new Date(rangeStart + 15 * 3600_000).toISOString(),
    };
    const { fetch: f, calls } = recordingFetch((call) => {
      const body = JSON.parse(String(call.init?.body));
      expect(body.timeMin).toBe(new Date(rangeStart).toISOString());
      expect(body.timeMax).toBe(new Date(rangeEnd).toISOString());
      expect(body.items).toEqual([{ id: "a" }, { id: "b" }]);
      return new Response(
        JSON.stringify({
          calendars: {
            a: { busy: [busy1] },
            b: { busy: [busy2] },
          },
        }),
        { status: 200 },
      );
    });
    const intervals = await queryFreeBusy({
      accessToken: TOKEN,
      calendarIds: ["a", "b"],
      rangeStart,
      rangeEnd,
      fetchImpl: f,
    });
    expect(intervals).toEqual([
      { start: rangeStart + 9 * 3600_000, end: rangeStart + 10 * 3600_000 },
      { start: rangeStart + 14 * 3600_000, end: rangeStart + 15 * 3600_000 },
    ]);
    expect(calls[0]?.url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
  });

  test("returns empty when no calendar IDs", async () => {
    const { fetch: f, calls } = recordingFetch(() => new Response("{}", { status: 200 }));
    const intervals = await queryFreeBusy({
      accessToken: TOKEN,
      calendarIds: [],
      rangeStart: 0,
      rangeEnd: 1,
      fetchImpl: f,
    });
    expect(intervals).toEqual([]);
    expect(calls.length).toBe(0);
  });
});

describe("createEvent", () => {
  test("requests Meet via conferenceData and parses URL", async () => {
    const startMs = Date.UTC(2026, 3, 27, 1, 0);
    const endMs = Date.UTC(2026, 3, 27, 2, 0);
    const { fetch: f, calls } = recordingFetch((call) => {
      expect(call.url).toContain("/calendars/primary%40example.com/events");
      expect(call.url).toContain("conferenceDataVersion=1");
      expect(call.url).toContain("sendUpdates=all");
      const body = JSON.parse(String(call.init?.body));
      expect(body.summary).toBe("30 min meet");
      expect(body.start).toEqual({
        dateTime: new Date(startMs).toISOString(),
        timeZone: "Asia/Tokyo",
      });
      expect(body.attendees).toEqual([{ email: "guest@x.com", displayName: "Guest" }]);
      expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
      return new Response(
        JSON.stringify({
          id: "evt-1",
          htmlLink: "https://www.google.com/calendar/event?eid=evt-1",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        }),
        { status: 200 },
      );
    });
    const created = await createEvent({
      accessToken: TOKEN,
      calendarId: "primary@example.com",
      startMs,
      endMs,
      timeZone: "Asia/Tokyo",
      title: "30 min meet",
      attendees: [{ email: "guest@x.com", displayName: "Guest" }],
      fetchImpl: f,
    });
    expect(created.id).toBe("evt-1");
    expect(created.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(calls.length).toBe(1);
  });

  test("falls back to conferenceData entryPoints when hangoutLink missing", async () => {
    const { fetch: f } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({
            id: "evt-2",
            conferenceData: {
              entryPoints: [
                { entryPointType: "phone", uri: "tel:+81-3-..." },
                { entryPointType: "video", uri: "https://meet.google.com/zzz-yyy-xxx" },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    const ev = await createEvent({
      accessToken: TOKEN,
      calendarId: "primary",
      startMs: 0,
      endMs: 60_000,
      timeZone: "Asia/Tokyo",
      title: "t",
      attendees: [],
      fetchImpl: f,
    });
    expect(ev.meetUrl).toBe("https://meet.google.com/zzz-yyy-xxx");
  });

  test("omits conferenceData when generateMeetUrl=false", async () => {
    const { fetch: f, calls } = recordingFetch(
      () => new Response(JSON.stringify({ id: "evt-3" }), { status: 200 }),
    );
    await createEvent({
      accessToken: TOKEN,
      calendarId: "primary",
      startMs: 0,
      endMs: 60_000,
      timeZone: "UTC",
      title: "t",
      attendees: [],
      generateMeetUrl: false,
      fetchImpl: f,
    });
    expect(calls[0]?.url).not.toContain("conferenceDataVersion");
    expect(JSON.parse(String(calls[0]?.init?.body)).conferenceData).toBeUndefined();
  });
});

describe("deleteEvent", () => {
  test("issues DELETE and tolerates 404/410", async () => {
    const { fetch: f, calls } = recordingFetch(() => new Response("", { status: 410 }));
    await deleteEvent({
      accessToken: TOKEN,
      calendarId: "primary",
      eventId: "evt-x",
      fetchImpl: f,
    });
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.url).toContain("/calendars/primary/events/evt-x");
    expect(calls[0]?.url).toContain("sendUpdates=all");
  });

  test("throws on 500", async () => {
    const { fetch: f } = recordingFetch(() => new Response("oops", { status: 500 }));
    await expect(
      deleteEvent({ accessToken: TOKEN, calendarId: "p", eventId: "e", fetchImpl: f }),
    ).rejects.toThrow(/500/);
  });
});
