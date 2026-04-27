import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import {
  availabilityLinks,
  bookings,
  googleCalendars,
  googleOauthAccounts,
  users,
} from "@/db/schema";
import { createBookingNotifier } from "@/notifications/booking-notifier";
import type { BookingEvent, EmailMessage, SendEmailFn } from "@/notifications/types";
import { createTestDb, type TestDb } from "@/test/integration-db";
// Side-effect import: registers `mock.module("@/lib/http")` so the cancel
// flow's `deleteEvent` call (transitively through @/google/calendar) hits
// the mocked httpFetch instead of the real network.
import { httpFetchMock } from "@/test/mock-http";
import { cancelBookingByOwner, cancelBookingByToken } from "./cancel";
import type { GoogleSinks, NotificationSinks } from "./confirm";

const TZ = "Asia/Tokyo";

let testDb: TestDb;
let sentEmails: EmailMessage[];
let notifyCalls: BookingEvent[];

const captureSendEmail: SendEmailFn = async (msg: EmailMessage) => {
  sentEmails.push(msg);
};

/**
 * Build a `NotificationSinks` whose `notifier` records every event AND
 * dispatches via the real `createBookingNotifier` adapter — same approach as
 * `confirm.test.ts` so we can assert on both the published event shape and
 * the rendered email envelopes.
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

const noGoogleSinks: GoogleSinks = {
  cfg: null,
  createEvent: async () => {
    throw new Error("createEvent should not be called in cancel tests");
  },
  getAccessToken: async () => {
    throw new Error("getAccessToken should not be called in no-Google cancel tests");
  },
};

const notifications: NotificationSinks = buildNotifications();

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

type SeedResult = {
  userId: string;
  linkId: string;
  bookingId: string;
  cancellationToken: string;
};

async function seedConfirmedBooking(
  options: { withGoogleEvent?: boolean; withGoogleAccount?: boolean } = {},
): Promise<SeedResult> {
  const [user] = await testDb
    .insert(users)
    .values({ clerkId: `clerk_${randomUUID()}`, email: "owner@example.com", name: "Owner" })
    .returning();
  if (!user) throw new Error("seed user");
  const [link] = await testDb
    .insert(availabilityLinks)
    .values({
      userId: user.id,
      slug: "intro-30min",
      title: "30 min meet",
      durationMinutes: 30,
      timeZone: TZ,
      isPublished: true,
    })
    .returning();
  if (!link) throw new Error("seed link");

  if (options.withGoogleAccount) {
    const [account] = await testDb
      .insert(googleOauthAccounts)
      .values({
        userId: user.id,
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
    if (!account) throw new Error("seed oauth");
    await testDb.insert(googleCalendars).values({
      oauthAccountId: account.id,
      googleCalendarId: "primary@example.com",
      summary: "Owner",
      timeZone: TZ,
      isPrimary: true,
      usedForBusy: true,
      usedForWrites: true,
    });
  }

  const cancellationToken = randomUUID();
  const [booking] = await testDb
    .insert(bookings)
    .values({
      linkId: link.id,
      startAt: new Date("2026-12-14T05:00:00Z"),
      endAt: new Date("2026-12-14T05:30:00Z"),
      guestName: "Guest",
      guestEmail: "guest@example.com",
      status: "confirmed",
      cancellationToken,
      googleEventId: options.withGoogleEvent ? "evt-google-1" : null,
      meetUrl: options.withGoogleEvent ? "https://meet.google.com/abc" : null,
    })
    .returning();
  if (!booking) throw new Error("seed booking");
  return {
    userId: user.id,
    linkId: link.id,
    bookingId: booking.id,
    cancellationToken,
  };
}

describe("cancelBookingByToken", () => {
  test("happy path: cancels confirmed booking and fires owner+guest emails", async () => {
    const seed = await seedConfirmedBooking();

    const result = await cancelBookingByToken(
      db,
      seed.cancellationToken,
      noGoogleSinks,
      notifications,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.status).toBe("canceled");
    expect(result.booking.canceledAt).not.toBeNull();

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();

    expect(sentEmails.length).toBe(2);
    expect(sentEmails.map((e) => e.to).sort()).toEqual(["guest@example.com", "owner@example.com"]);
    // canceledBy = "guest" path: guest mail mirrors actor.
    const guestMail = sentEmails.find((e) => e.to === "guest@example.com");
    expect(guestMail?.text).toContain("あなた");

    // ISH-123: usecase published exactly one domain event of the right shape.
    expect(notifyCalls.length).toBe(1);
    const event = notifyCalls[0];
    expect(event?.kind).toBe("booking_canceled");
    if (event?.kind !== "booking_canceled") throw new Error("unexpected event kind");
    expect(event.canceledBy).toBe("guest");
    expect(event.booking.id).toBe(seed.bookingId);
    expect(event.owner.email).toBe("owner@example.com");
  });

  test("unknown token → kind:'not_found'", async () => {
    const result = await cancelBookingByToken(db, randomUUID(), noGoogleSinks, notifications);
    expect(result.kind).toBe("not_found");
    expect(sentEmails.length).toBe(0);
  });

  test("idempotent: second cancel returns kind:'already_canceled' and fires no emails", async () => {
    const seed = await seedConfirmedBooking();

    const first = await cancelBookingByToken(
      db,
      seed.cancellationToken,
      noGoogleSinks,
      notifications,
    );
    expect(first.kind).toBe("ok");
    expect(sentEmails.length).toBe(2);

    sentEmails = [];
    const second = await cancelBookingByToken(
      db,
      seed.cancellationToken,
      noGoogleSinks,
      notifications,
    );
    expect(second.kind).toBe("already_canceled");
    expect(sentEmails.length).toBe(0);
  });
});

describe("cancelBookingByOwner", () => {
  test("happy path: owner cancel succeeds and emails go out with canceledBy='owner'", async () => {
    const seed = await seedConfirmedBooking();

    const result = await cancelBookingByOwner(
      db,
      seed.bookingId,
      seed.userId,
      noGoogleSinks,
      notifications,
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unexpected kind");
    expect(result.booking.status).toBe("canceled");

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("canceled");

    expect(sentEmails.length).toBe(2);
    // canceledBy = "owner": owner-side message says "あなた" (= owner did it).
    const ownerMail = sentEmails.find((e) => e.to === "owner@example.com");
    expect(ownerMail?.text).toContain("あなた");
  });

  test("unknown bookingId → kind:'not_found'", async () => {
    const result = await cancelBookingByOwner(
      db,
      randomUUID(),
      randomUUID(),
      noGoogleSinks,
      notifications,
    );
    expect(result.kind).toBe("not_found");
    expect(sentEmails.length).toBe(0);
  });

  test("authorization: a non-owner user gets kind:'not_found' (no info-leak vs unknown id)", async () => {
    const seed = await seedConfirmedBooking();
    // Different user — must not be able to cancel someone else's booking.
    const [intruder] = await testDb
      .insert(users)
      .values({ clerkId: `clerk_${randomUUID()}`, email: "intruder@example.com" })
      .returning();
    if (!intruder) throw new Error("seed intruder");

    const result = await cancelBookingByOwner(
      db,
      seed.bookingId,
      intruder.id,
      noGoogleSinks,
      notifications,
    );
    expect(result.kind).toBe("not_found");

    // Booking must still be confirmed; emails must not fire.
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("confirmed");
    expect(sentEmails.length).toBe(0);
  });

  test("idempotent: second owner-cancel returns 'already_canceled' and fires no emails", async () => {
    const seed = await seedConfirmedBooking();

    const first = await cancelBookingByOwner(
      db,
      seed.bookingId,
      seed.userId,
      noGoogleSinks,
      notifications,
    );
    expect(first.kind).toBe("ok");
    expect(sentEmails.length).toBe(2);

    sentEmails = [];
    const second = await cancelBookingByOwner(
      db,
      seed.bookingId,
      seed.userId,
      noGoogleSinks,
      notifications,
    );
    expect(second.kind).toBe("already_canceled");
    expect(sentEmails.length).toBe(0);
  });
});

describe("cancel side-effects — Google delete resilience", () => {
  // The cancel flow imports `deleteEvent` directly from `@/google/calendar`
  // (not via a port). The httpFetchMock from @/test/mock-http intercepts the
  // wrapper that `deleteEvent` calls; Neon Local DB queries go through
  // `globalThis.fetch` directly and are unaffected.
  function stubCalendarFetch(handler: () => Promise<Response>): void {
    httpFetchMock.mockImplementation(async () => handler());
  }

  beforeEach(() => {
    httpFetchMock.mockReset();
  });

  function withCfg(): GoogleSinks {
    return {
      cfg: {
        clientId: "x",
        clientSecret: "y",
        redirectUri: "z",
        encryptionKey: Buffer.alloc(32),
        appBaseUrl: "http://app",
      },
      createEvent: async () => {
        throw new Error("createEvent should not be called");
      },
      getAccessToken: async () => "fake-access-token",
    };
  }

  test("deleteEvent (HTTP) failure does not block cancellation — booking still canceled, emails still sent", async () => {
    const seed = await seedConfirmedBooking({
      withGoogleAccount: true,
      withGoogleEvent: true,
    });

    stubCalendarFetch(async () => {
      // Surface a 500 — deleteEvent throws on non-2xx (and not 404/410).
      return new Response("kaboom", { status: 500 });
    });

    const result = await cancelBookingByToken(db, seed.cancellationToken, withCfg(), notifications);

    expect(result.kind).toBe("ok");
    expect(httpFetchMock).toHaveBeenCalled();

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("canceled");
    // Emails still fire (best-effort policy applies independently to delete + email).
    expect(sentEmails.length).toBe(2);
  });

  test("Google delete throwing does not abort the cancel pipeline (fetch throws synchronously)", async () => {
    const seed = await seedConfirmedBooking({
      withGoogleAccount: true,
      withGoogleEvent: true,
    });

    stubCalendarFetch(async () => {
      throw new Error("network down");
    });

    const result = await cancelBookingByOwner(
      db,
      seed.bookingId,
      seed.userId,
      withCfg(),
      notifications,
    );

    expect(result.kind).toBe("ok");
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("canceled");
    expect(sentEmails.length).toBe(2);
  });
});

describe("cancel side-effects — email resilience", () => {
  test("sendEmail throws — cancellation is still committed (best-effort)", async () => {
    const seed = await seedConfirmedBooking();

    const failingNotifications = buildNotifications(async () => {
      throw new Error("smtp boom");
    });
    const result = await cancelBookingByToken(
      db,
      seed.cancellationToken,
      noGoogleSinks,
      failingNotifications,
    );

    expect(result.kind).toBe("ok");
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("canceled");
  });

  test("notifier.notify throws — cancellation is still committed (usecase swallows)", async () => {
    const seed = await seedConfirmedBooking();

    const result = await cancelBookingByToken(db, seed.cancellationToken, noGoogleSinks, {
      notifier: {
        notify: async () => {
          throw new Error("notifier boom");
        },
      },
    });

    expect(result.kind).toBe("ok");
    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, seed.bookingId));
    expect(row?.status).toBe("canceled");
  });
});
