import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import {
  availabilityLinks,
  availabilityRules,
  bookings,
  googleCalendars,
  googleOauthAccounts,
  users,
} from "@/db/schema";
import type { LinkWithRelations } from "@/links/domain";
import { findPublishedLinkBySlug } from "@/links/repo";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import type { BookingEvent, EmailMessage, SendEmailFn } from "@/notifications/types";
import { createTestDb, type TestDb } from "@/test/integration-db";
import {
  type ConfirmInput,
  type ConfirmResult,
  type CreateEventFn,
  confirmBooking,
  type GetAccessTokenFn,
  type GoogleSinks,
  type NotificationSinks,
} from "./confirm";

const TZ = "Asia/Tokyo";
// Pick a Monday far enough in the future that Date.now() is always earlier.
// 2026-12-14 (Monday). 14:00 JST = 05:00 UTC.
const SLOT_START_ISO = "2026-12-14T05:00:00.000Z";
const SLOT_START_MS = Date.parse(SLOT_START_ISO);
const SLOT_END_MS = SLOT_START_MS + 30 * 60_000;

let testDb: TestDb;
let sentEmails: EmailMessage[];
let notifyCalls: BookingEvent[];

const captureSendEmail: SendEmailFn = async (msg: EmailMessage) => {
  sentEmails.push(msg);
};

/**
 * Build a `NotificationSinks` whose `notifier` records every event it
 * receives AND dispatches via the real `createBookingNotifier` adapter so the
 * SendEmail pipeline + template rendering is also exercised end-to-end.
 *
 * Tests can therefore assert on:
 *   - the published domain event shape (`notifyCalls[0].kind === "booking_confirmed"`)
 *   - the rendered email envelopes (`sentEmails`)
 * without re-implementing the templates in the test file.
 */
function buildNotifications(
  sendEmail: SendEmailFn = captureSendEmail,
  appBaseUrl = "https://app.test",
): NotificationSinks {
  const adapter = createBookingNotifier({ sendEmail, appBaseUrl });
  return {
    notifier: {
      async notify(event) {
        notifyCalls.push(event);
        await adapter.notify(event);
      },
    },
  };
}

type SeededLink = {
  userId: string;
  link: LinkWithRelations;
};

async function seedPublishedLink(
  db: TestDb,
  overrides: { slug?: string } = {},
): Promise<SeededLink> {
  const [user] = await db
    .insert(users)
    .values({ clerkId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed: user insert failed");
  const slug = overrides.slug ?? "intro-30min";
  const [linkRow] = await db
    .insert(availabilityLinks)
    .values({
      userId: user.id,
      slug,
      title: "30 min meeting",
      description: "intro chat",
      durationMinutes: 30,
      // Far horizon so the fixed test slot stays valid regardless of when the
      // suite runs (default 60 days would expire the slot below).
      rangeDays: 3650,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!linkRow) throw new Error("seed: link insert failed");
  // Mon-Fri 9-17 JST
  for (const weekday of [1, 2, 3, 4, 5]) {
    await db
      .insert(availabilityRules)
      .values({ linkId: linkRow.id, weekday, startMinute: 9 * 60, endMinute: 17 * 60 });
  }
  // Use the @/db/client singleton (already swapped via setDbForTests) so the
  // Database type matches usecase signatures.
  const { db: clientDb } = await import("@/db/client");
  const link = await findPublishedLinkBySlug(clientDb, slug);
  if (!link) throw new Error("seed: published link not found after insert");
  return { userId: user.id, link };
}

async function seedGoogleCalendar(db: TestDb, userId: string): Promise<string> {
  const [account] = await db
    .insert(googleOauthAccounts)
    .values({
      userId,
      googleUserId: `g_${randomUUID()}`,
      email: "owner@example.com",
      encryptedRefreshToken: "ct",
      refreshTokenIv: "iv",
      refreshTokenAuthTag: "tag",
      accessToken: "at",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: "calendar.events",
    })
    .returning();
  if (!account) throw new Error("seed: oauth insert failed");
  await db.insert(googleCalendars).values({
    oauthAccountId: account.id,
    googleCalendarId: "primary@example.com",
    summary: "Owner",
    timeZone: TZ,
    isPrimary: true,
    usedForBusy: true,
    usedForWrites: true,
  });
  return account.id;
}

const noGoogleSinks: GoogleSinks = {
  cfg: null,
  createEvent: async () => {
    throw new Error("createEvent should not be called in no-Google tests");
  },
  getAccessToken: async () => {
    throw new Error("getAccessToken should not be called in no-Google tests");
  },
};

function googleSinksWith(overrides: {
  createEvent?: CreateEventFn;
  getAccessToken?: GetAccessTokenFn;
}): GoogleSinks {
  return {
    cfg: {
      clientId: "x",
      clientSecret: "y",
      redirectUri: "z",
      encryptionKey: Buffer.alloc(32),
      appBaseUrl: "http://app",
    },
    createEvent:
      overrides.createEvent ??
      (async () => ({
        id: "evt-1",
        meetUrl: "https://meet.google.com/abc-defg-hij",
        htmlLink: "https://example.com/evt-1",
      })),
    getAccessToken: overrides.getAccessToken ?? (async () => "fake-access-token"),
  };
}

const notifications: NotificationSinks = buildNotifications();

const validInput = (): ConfirmInput => ({
  startMs: SLOT_START_MS,
  guestName: "Guest Name",
  guestEmail: "guest@example.com",
  guestNote: null,
  guestTimeZone: null,
});

beforeAll(async () => {
  testDb = await createTestDb();
  setDbForTests(testDb);
}, 30_000);

afterAll(async () => {
  clearDbForTests();
  await testDb.$client.close();
});

beforeEach(async () => {
  sentEmails = [];
  notifyCalls = [];
  await testDb.$client.exec(`
    TRUNCATE TABLE bookings, availability_excludes, availability_rules,
    availability_links, google_calendars, google_oauth_accounts, users
    RESTART IDENTITY CASCADE;
  `);
});

describe("confirmBooking — happy path without Google", () => {
  test("inserts a confirmed booking and fires both confirmation emails", async () => {
    const seed = await seedPublishedLink(testDb);

    const result = await confirmBooking(db, seed.link, validInput(), noGoogleSinks, notifications);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.status).toBe("confirmed");
    expect(result.booking.startAt.getTime()).toBe(SLOT_START_MS);
    expect(result.booking.endAt.getTime()).toBe(SLOT_END_MS);
    expect(result.booking.guestEmail).toBe("guest@example.com");
    // No Google sync → no event id, no meet URL.
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
    expect(result.booking.cancellationToken).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);

    // ISH-123: usecase publishes a single domain event; the notifier adapter
    // is what fans it out to owner + guest emails.
    expect(notifyCalls.length).toBe(1);
    const event = notifyCalls[0];
    expect(event?.kind).toBe("booking_confirmed");
    if (event?.kind !== "booking_confirmed") throw new Error("unexpected event kind");
    expect(event.booking.id).toBe(result.booking.id);
    expect(event.cancellationToken).toBe(result.booking.cancellationToken);
    expect(event.owner.email).toBe("owner@example.com");
    expect(event.link.title).toBe("30 min meeting");

    // Owner + guest email rendered by the adapter.
    expect(sentEmails.length).toBe(2);
    expect(sentEmails.map((e) => e.to).sort()).toEqual(["guest@example.com", "owner@example.com"]);
    // Cancel URL is built from the notifier's appBaseUrl + token.
    const guestEmail = sentEmails.find((e) => e.to === "guest@example.com");
    expect(guestEmail).toBeDefined();
    expect(guestEmail?.text).toContain(
      `https://app.test/cancel/${result.booking.cancellationToken}`,
    );
  });
});

describe("confirmBooking — Google integration", () => {
  test("publishes the event, persists googleEventId + meetUrl, and emails go out", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId);

    let createEventCalled = 0;
    let lastTitle: string | undefined;
    const sinks = googleSinksWith({
      createEvent: async (input) => {
        createEventCalled += 1;
        lastTitle = input.title;
        return {
          id: "evt-google-1",
          meetUrl: "https://meet.google.com/abc-defg-hij",
          htmlLink: "https://example.com/evt-google-1",
        };
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), sinks, notifications);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.googleEventId).toBe("evt-google-1");
    expect(result.booking.meetUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(createEventCalled).toBe(1);
    expect(lastTitle).toBe("30 min meeting");

    const [persisted] = await testDb
      .select()
      .from(bookings)
      .where(eq(bookings.id, result.booking.id));
    expect(persisted?.googleEventId).toBe("evt-google-1");
    expect(persisted?.meetUrl).toBe("https://meet.google.com/abc-defg-hij");

    expect(sentEmails.length).toBe(2);
  });

  test("Google account not connected: booking succeeds without Google sync", async () => {
    // cfg is set but the user has no oauth account row → getOauthAccountByUser returns null.
    const seed = await seedPublishedLink(testDb);
    let createEventCalled = 0;
    const sinks = googleSinksWith({
      createEvent: async () => {
        createEventCalled += 1;
        return { id: "should-not-be-used" };
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), sinks, notifications);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(createEventCalled).toBe(0);
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
    expect(sentEmails.length).toBe(2);
  });

  test("createEvent throws — booking still stands (no rollback); googleEventId null", async () => {
    // Current behavior pin (ISH-130): the booking is committed BEFORE the
    // Google event is created, and the calendar sync block is wrapped in a
    // try/catch that only logs. So a createEvent failure leaves a confirmed
    // booking with no googleEventId / meetUrl. If this should change in the
    // future (e.g. retry queue) it belongs in a separate PR.
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId);

    let createEventCalls = 0;
    const sinks = googleSinksWith({
      createEvent: async () => {
        createEventCalls += 1;
        throw new Error("calendar boom");
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), sinks, notifications);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    // Booking persisted, but without googleEventId / meetUrl.
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
    expect(createEventCalls).toBe(1);

    const [persisted] = await testDb
      .select()
      .from(bookings)
      .where(eq(bookings.id, result.booking.id));
    expect(persisted?.status).toBe("confirmed");
    expect(persisted?.googleEventId).toBeNull();
    expect(persisted?.meetUrl).toBeNull();

    // Email side-effects still ran.
    expect(sentEmails.length).toBe(2);
  });

  test("getAccessToken throws — booking still stands (no rollback)", async () => {
    const seed = await seedPublishedLink(testDb);
    await seedGoogleCalendar(testDb, seed.userId);

    let createEventCalls = 0;
    const sinks = googleSinksWith({
      getAccessToken: async () => {
        throw new Error("token boom");
      },
      createEvent: async () => {
        createEventCalls += 1;
        return { id: "evt-x" };
      },
    });

    const result = await confirmBooking(db, seed.link, validInput(), sinks, notifications);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(createEventCalls).toBe(0);
    expect(result.booking.googleEventId).toBeNull();
    expect(result.booking.meetUrl).toBeNull();
  });
});

describe("confirmBooking — notifications resilience", () => {
  test("sendEmail throws — booking is still committed (best-effort policy)", async () => {
    const seed = await seedPublishedLink(testDb);

    const failingNotifications = buildNotifications(async () => {
      throw new Error("smtp boom");
    });
    const result = await confirmBooking(
      db,
      seed.link,
      validInput(),
      noGoogleSinks,
      failingNotifications,
    );

    expect(result.kind).toBe("ok");
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("confirmed");
  });

  test("notifier.notify throws — booking is still committed (usecase swallows)", async () => {
    const seed = await seedPublishedLink(testDb);

    const result = await confirmBooking(db, seed.link, validInput(), noGoogleSinks, {
      notifier: {
        notify: async () => {
          throw new Error("notifier boom");
        },
      },
    });

    expect(result.kind).toBe("ok");
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe("confirmed");
  });
});

describe("confirmBooking — slot conflict / availability guards", () => {
  test("slot outside availability window → kind:'slot_unavailable'", async () => {
    const seed = await seedPublishedLink(testDb);
    // Sunday 2026-12-13 — outside Mon-Fri windows.
    const sundayMs = Date.parse("2026-12-13T05:00:00.000Z");
    const result = await confirmBooking(
      db,
      seed.link,
      {
        startMs: sundayMs,
        guestName: "Guest",
        guestEmail: "guest@example.com",
        guestNote: null,
        guestTimeZone: null,
      },
      noGoogleSinks,
      notifications,
    );

    expect(result.kind).toBe("slot_unavailable");
    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(0);
    expect(sentEmails.length).toBe(0);
  });

  test("dual-booking same slot → kind:'race_lost' (409 shape) and only one row exists", async () => {
    const seed = await seedPublishedLink(testDb);

    const first = await confirmBooking(db, seed.link, validInput(), noGoogleSinks, notifications);
    expect(first.kind).toBe("ok");

    const second: ConfirmResult = await confirmBooking(
      db,
      seed.link,
      { ...validInput(), guestEmail: "different@example.com" },
      noGoogleSinks,
      notifications,
    );

    expect(second.kind).toBe("race_lost");

    const rows = await testDb.select().from(bookings);
    expect(rows.length).toBe(1);
    expect(rows[0]?.guestEmail).toBe("guest@example.com");
  });
});
