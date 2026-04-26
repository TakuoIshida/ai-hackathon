import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { clearDbForTests, setDbForTests } from "@/db/client";
import { availabilityLinks, bookings, users } from "@/db/schema";
import { createPublicRoute, type PublicRouteDeps } from "@/routes/public";
import { createTestDb, type TestDb } from "@/test/integration-db";

const TZ = "Asia/Tokyo";

let testDb: TestDb;
let sentEmails: { to: string; subject: string }[];

const noGoogleDeps: PublicRouteDeps = {
  loadCfg: () => null,
  createEvent: async () => {
    throw new Error("createEvent should not be called");
  },
  getAccessToken: async () => {
    throw new Error("getAccessToken should not be called");
  },
  sendEmail: async (msg) => {
    sentEmails.push({ to: msg.to, subject: msg.subject });
  },
  appBaseUrl: "https://app.test",
};

function buildApp(deps: PublicRouteDeps = noGoogleDeps): Hono {
  const app = new Hono();
  app.route("/public", createPublicRoute(deps));
  return app;
}

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
  await testDb.$client.exec(`
    TRUNCATE TABLE bookings, availability_excludes, availability_rules,
    availability_links, google_calendars, google_oauth_accounts, users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedConfirmedBooking(token: string): Promise<{ bookingId: string }> {
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
  const [booking] = await testDb
    .insert(bookings)
    .values({
      linkId: link.id,
      startAt: new Date("2026-12-14T05:00:00Z"),
      endAt: new Date("2026-12-14T05:30:00Z"),
      guestName: "Guest",
      guestEmail: "guest@example.com",
      status: "confirmed",
      cancellationToken: token,
    })
    .returning();
  if (!booking) throw new Error("seed booking");
  return { bookingId: booking.id };
}

describe("POST /public/cancel/:token", () => {
  test("400 on malformed token", async () => {
    const app = buildApp();
    const res = await app.request("/public/cancel/not-a-uuid", { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("404 when token does not match", async () => {
    const app = buildApp();
    const res = await app.request(`/public/cancel/${randomUUID()}`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("happy path: cancels confirmed booking, fires both emails, slot is reusable", async () => {
    const token = randomUUID();
    const { bookingId } = await seedConfirmedBooking(token);
    const app = buildApp();

    const res = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(res.status).toBe(200);

    const [row] = await testDb.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(row?.status).toBe("canceled");
    expect(row?.canceledAt).not.toBeNull();

    expect(sentEmails.length).toBe(2);
    expect(sentEmails.map((e) => e.to).sort()).toEqual(["guest@example.com", "owner@example.com"]);
    for (const e of sentEmails) expect(e.subject).toContain("予約キャンセル");
  });

  test("idempotent: second cancel returns alreadyCanceled and skips emails", async () => {
    const token = randomUUID();
    await seedConfirmedBooking(token);
    const app = buildApp();
    const first = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(sentEmails.length).toBe(2);

    sentEmails = [];
    const second = await app.request(`/public/cancel/${token}`, { method: "POST" });
    expect(second.status).toBe(200);
    const json = (await second.json()) as { alreadyCanceled?: boolean };
    expect(json.alreadyCanceled).toBe(true);
    expect(sentEmails.length).toBe(0);
  });

  test("after cancel, the same slot can be re-booked (partial unique index frees it)", async () => {
    const token = randomUUID();
    await seedConfirmedBooking(token);
    const app = buildApp();
    await app.request(`/public/cancel/${token}`, { method: "POST" });

    // The slot is now free — we can insert another confirmed booking for the same (link, start_at).
    const beforeCount = await testDb.select().from(bookings);
    const linkId = beforeCount[0]?.linkId;
    expect(linkId).toBeDefined();

    const [reBook] = await testDb
      .insert(bookings)
      .values({
        linkId: linkId as string,
        startAt: new Date("2026-12-14T05:00:00Z"),
        endAt: new Date("2026-12-14T05:30:00Z"),
        guestName: "Guest 2",
        guestEmail: "g2@example.com",
        status: "confirmed",
      })
      .returning();
    expect(reBook?.status).toBe("confirmed");
  });
});
