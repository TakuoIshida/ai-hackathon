import type { Interval } from "@/scheduling";

/**
 * Calendar metadata view exposed to feature usecases. Only carries the fields
 * cross-feature callers actually use (which calendar to write to / merge busy
 * for); the full `googleCalendars` row never escapes the adapter.
 */
export type CalendarView = {
  googleCalendarId: string;
  usedForBusy: boolean;
  usedForWrites: boolean;
};

/**
 * OAuth account reference exposed to feature usecases. Only the row id is
 * needed — refresh tokens, scopes, and the rest of the row stay inside the
 * Google adapter.
 */
export type OauthAccountRef = {
  id: string;
};

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
};

export type CreatedEvent = {
  id: string;
  meetUrl?: string;
  htmlLink?: string;
};

export type FreeBusyInput = {
  accessToken: string;
  calendarIds: ReadonlyArray<string>;
  rangeStart: number;
  rangeEnd: number;
};

export type EventDeleteInput = {
  accessToken: string;
  calendarId: string;
  eventId: string;
};

/**
 * Single port for the Google integration surface used by feature usecases.
 *
 * Bookings (`confirm` / `cancel`) and links (`computePublicSlots`) all go
 * through this port — they no longer import `@/google/repo`,
 * `@/google/calendar`, or `@/google/access-token` directly. The production
 * adapter is assembled in `wiring.ts`; tests inject a fake.
 *
 * Routes pass `null` here when Google env vars are unset — usecases interpret
 * that as "Google disabled" and skip calendar sync / busy merge.
 */
export type GooglePort = {
  /**
   * Resolve the local oauth_accounts row for a user, or null when the user
   * hasn't connected Google yet. Implemented as a DB read in production.
   */
  getOauthAccountByUser(userId: string): Promise<OauthAccountRef | null>;
  /** All calendars known for an oauth account (DB read). */
  listUserCalendars(oauthAccountId: string): Promise<ReadonlyArray<CalendarView>>;
  /** Resolve a fresh, unexpired access token (refreshes via Google if needed). */
  getValidAccessToken(oauthAccountId: string): Promise<string>;
  /** Free/busy lookup across the given calendar IDs. */
  getFreeBusy(input: FreeBusyInput): Promise<ReadonlyArray<Interval>>;
  /** Insert an event on the given calendar. */
  createEvent(input: EventCreateInput): Promise<CreatedEvent>;
  /** Delete an event. Adapters treat 404/410 as success. */
  deleteEvent(input: EventDeleteInput): Promise<void>;
};
