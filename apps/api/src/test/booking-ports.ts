import type { CancelBookingPorts } from "@/bookings/cancel";
import type { ConfirmBookingPorts } from "@/bookings/confirm";
import type { db as DbClient } from "@/db/client";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import type { BookingEvent, EmailMessage, SendEmailFn } from "@/notifications/types";
import type {
  GooglePort,
  LinkAvailabilityPort,
  LinkLookupPort,
  NotificationPort,
  UserLookupPort,
} from "@/ports";
import {
  buildGooglePort,
  buildLinkAvailabilityPort,
  buildLinkLookupPort,
  buildUserLookupPort,
} from "@/wiring";

type Database = typeof DbClient;

/**
 * Placeholder Google config for tests that need a non-null cfg only so
 * `buildGooglePort` returns a port. The values are never used because tests
 * override `getValidAccessToken`/`createEvent`/`deleteEvent` on top of the
 * built port — production uses the real config.
 */
export const placeholderGoogleConfig = {
  clientId: "x",
  clientSecret: "y",
  redirectUri: "z",
  encryptionKey: Buffer.alloc(32),
  appBaseUrl: "http://app",
};

/**
 * Build a `GooglePort` based on the production wiring with selective stubs.
 *
 * - DB reads (`getOauthAccountByUser`, `listUserCalendars`): default to the
 *   real adapter (hits the integration test DB), override to inject fakes.
 * - HTTP-side calls (`createEvent`, `deleteEvent`): default to the real
 *   adapter (goes through `@/lib/http` → `httpFetch`, which the cancel tests
 *   mock via `@/test/mock-http`). Override to bypass the network.
 * - Token / busy: default to harmless stubs (`"fake-access-token"`, `[]`) so
 *   tests that don't care about Google can ignore them; override to assert
 *   call counts or simulate failure.
 *
 * Defaulting createEvent/deleteEvent to the *real* adapter is intentional —
 * tests that swap fetch via `httpFetchMock` need the real codepath to fire.
 */
export function buildTestGooglePort(
  database: Database,
  overrides: Partial<GooglePort> = {},
): GooglePort {
  const real = buildGooglePort(database, placeholderGoogleConfig);
  if (!real) throw new Error("buildGooglePort returned null with placeholder cfg");
  return {
    ...real,
    getValidAccessToken: overrides.getValidAccessToken ?? (async () => "fake-access-token"),
    getFreeBusy: overrides.getFreeBusy ?? (async () => []),
    ...(overrides.getOauthAccountByUser
      ? { getOauthAccountByUser: overrides.getOauthAccountByUser }
      : {}),
    ...(overrides.listUserCalendars ? { listUserCalendars: overrides.listUserCalendars } : {}),
    ...(overrides.createEvent ? { createEvent: overrides.createEvent } : {}),
    ...(overrides.deleteEvent ? { deleteEvent: overrides.deleteEvent } : {}),
  };
}

export type BookingTestSinks = {
  sentEmails: EmailMessage[];
  notifyCalls: BookingEvent[];
  notifier: NotificationPort;
  links: LinkLookupPort;
  users: UserLookupPort;
  availability: LinkAvailabilityPort;
};

/**
 * Assemble the cross-feature port set bookings tests need. The notifier
 * captures published events AND drives the real `createBookingNotifier`
 * adapter so template rendering + sendEmail are exercised; the lookup
 * ports go through `wiring.ts` so they read the test DB the same way
 * production reads Neon.
 */
export function buildBookingTestSinks(
  database: Database,
  options: {
    google?: GooglePort | null;
    sendEmail?: SendEmailFn;
    appBaseUrl?: string;
  } = {},
): BookingTestSinks {
  const sentEmails: EmailMessage[] = [];
  const notifyCalls: BookingEvent[] = [];
  const sendEmail: SendEmailFn =
    options.sendEmail ??
    (async (msg) => {
      sentEmails.push(msg);
    });
  const adapter = createBookingNotifier({
    sendEmail,
    appBaseUrl: options.appBaseUrl ?? "https://app.test",
  });
  const notifier: NotificationPort = {
    async notify(event) {
      notifyCalls.push(event);
      await adapter.notify(event);
    },
  };
  return {
    sentEmails,
    notifyCalls,
    notifier,
    links: buildLinkLookupPort(database),
    users: buildUserLookupPort(database),
    availability: buildLinkAvailabilityPort(database, options.google ?? null),
  };
}

/**
 * Convenience: assemble a full `ConfirmBookingPorts` from a `BookingTestSinks`
 * + a Google port (or null). Mirrors how route handlers compose ports.
 */
export function toConfirmPorts(
  sinks: BookingTestSinks,
  google: GooglePort | null,
): ConfirmBookingPorts {
  return {
    google,
    links: sinks.links,
    availability: sinks.availability,
    users: sinks.users,
    notifier: sinks.notifier,
  };
}

export function toCancelPorts(
  sinks: BookingTestSinks,
  google: GooglePort | null,
): CancelBookingPorts {
  return {
    google,
    links: sinks.links,
    users: sinks.users,
    notifier: sinks.notifier,
  };
}
