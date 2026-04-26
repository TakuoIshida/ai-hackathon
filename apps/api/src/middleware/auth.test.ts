import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { clearDbForTests, setDbForTests } from "@/db/client";
import { users } from "@/db/schema";
import {
  type AuthVars,
  attachDbUser,
  getClerkUserId,
  getDbUser,
  requireAuth,
} from "@/middleware/auth";
import { createTestDb, type TestDb } from "@/test/integration-db";

// Set Clerk env so any module that lazy-reads it during import does not crash.
process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  setDbForTests(testDb);
}, 30_000);

afterAll(async () => {
  clearDbForTests();
  await testDb.$client.close();
});

beforeEach(async () => {
  await testDb.$client.exec(`
    TRUNCATE TABLE bookings, availability_excludes, availability_rules,
    availability_links, google_calendars, google_oauth_accounts, users
    RESTART IDENTITY CASCADE;
  `);
});

/**
 * Mints a fake Clerk session by setting the `clerkAuth` context variable that
 * `getAuth` from `@hono/clerk-auth` reads. Mirrors what `clerkMiddleware` does
 * after a successful JWT verification.
 *
 * The real `ClerkAuth` type is a large union of session-claim shapes; only
 * `userId` is read by our code (`requireAuth` / `getClerkUserId`), so we cast
 * to `never` to satisfy Hono's strictly-typed `c.set`.
 */
function fakeClerkSession(userId: string | null): MiddlewareHandler {
  return async (c, next) => {
    const value = userId ? { userId } : { userId: null };
    c.set("clerkAuth", value as never);
    await next();
  };
}

describe("requireAuth", () => {
  test("calls next() when Clerk session has a userId", async () => {
    const app = new Hono();
    app.use("*", fakeClerkSession("user_abc"));
    app.use("*", requireAuth);
    let nextCalled = false;
    app.get("/probe", (c) => {
      nextCalled = true;
      return c.json({ ok: true });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(nextCalled).toBe(true);
  });

  test("returns 401 when Clerk session has no userId", async () => {
    const app = new Hono();
    app.use("*", fakeClerkSession(null));
    app.use("*", requireAuth);
    let nextCalled = false;
    app.get("/probe", (c) => {
      nextCalled = true;
      return c.json({ ok: true });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(401);
    expect(nextCalled).toBe(false);
  });

  test("returns 401 when no Clerk middleware ran (no clerkAuth var set)", async () => {
    const app = new Hono();
    app.use("*", requireAuth);
    app.get("/probe", (c) => c.json({ ok: true }));

    const res = await app.request("/probe");
    expect(res.status).toBe(401);
  });
});

describe("getClerkUserId", () => {
  test("returns the userId when set", async () => {
    const app = new Hono();
    app.use("*", fakeClerkSession("user_xyz"));
    // Wrap in object so TS doesn't narrow to `null` (handler mutation is opaque
    // to control-flow analysis).
    const captured: { value: string | null } = { value: null };
    app.get("/probe", (c) => {
      captured.value = getClerkUserId(c);
      return c.json({ id: captured.value });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(captured.value).toBe("user_xyz");
  });

  test("throws 401 HTTPException when no userId", async () => {
    const app = new Hono();
    // No fakeClerkSession — getClerkUserId should throw
    app.get("/probe", (c) => {
      const id = getClerkUserId(c);
      return c.json({ id });
    });

    // Hono surfaces an HTTPException as the matching status code.
    const res = await app.request("/probe");
    expect(res.status).toBe(401);
  });
});

describe("attachDbUser", () => {
  test("sets dbUser on the context when the user already exists in DB", async () => {
    const clerkId = `clerk_existing_${randomUUID()}`;
    const [seeded] = await testDb
      .insert(users)
      .values({ clerkId, email: "existing@example.com", name: "Existing" })
      .returning();
    if (!seeded) throw new Error("seed failed");

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeClerkSession(clerkId));
    app.use("*", requireAuth);
    app.use("*", attachDbUser);
    app.get("/probe", (c) => {
      const u = getDbUser(c);
      return c.json({ id: u.id, clerkId: u.clerkId, email: u.email, name: u.name });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; clerkId: string; email: string; name: string };
    expect(body.id).toBe(seeded.id);
    expect(body.clerkId).toBe(clerkId);
    expect(body.email).toBe("existing@example.com");
    expect(body.name).toBe("Existing");
  });

  test("auto-creates the user via Clerk fetch when not in DB (current behavior pin)", async () => {
    // attachDbUser → ensureUserByClerkId → if missing, calls fetchClerkUser.
    // Here we have no fake Clerk fetch injected and no real Clerk available,
    // so the lazy fetch will fail. We assert: (a) there was no row before,
    // (b) the request errors out (NOT silently logs in as an empty user),
    // (c) no row was created (ensureUserByClerkId only inserts after a
    // successful Clerk payload).
    const clerkId = `clerk_missing_${randomUUID()}`;

    const before = await testDb.select().from(users);
    expect(before.find((u) => u.clerkId === clerkId)).toBeUndefined();

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeClerkSession(clerkId));
    app.use("*", requireAuth);
    app.use("*", attachDbUser);
    app.get("/probe", (c) => c.json({ id: getDbUser(c).id }));
    // Treat any thrown error as 500 so the request resolves rather than
    // rejecting the test. The CLERK_SECRET_KEY stub is not a real key, so
    // Clerk's API call will reject.
    app.onError((_err, c) => c.json({ error: "boom" }, 500));

    const res = await app.request("/probe");
    // We don't pin the exact status — only that it does NOT silently 200.
    // What we DO pin: no user row was created with this clerkId, since
    // ensureUserByClerkId only inserts after a successful Clerk payload.
    expect(res.status).not.toBe(200);

    const after = await testDb.select().from(users);
    expect(after.find((u) => u.clerkId === clerkId)).toBeUndefined();
  });

  test("auto-creates the user when fetchClerkUser is provided (happy lazy-create path)", async () => {
    // Direct unit-call into ensureUserByClerkId to pin the behavior
    // attachDbUser inherits: lazy-create from a Clerk payload.
    const { ensureUserByClerkId } = await import("@/users/usecase");
    const clerkId = `clerk_lazy_${randomUUID()}`;

    const created = await ensureUserByClerkId(testDb as never, clerkId, {
      fetchClerkUser: async (id) => ({
        id,
        email_addresses: [{ id: "e1", email_address: `${id}@example.com` }],
        primary_email_address_id: "e1",
        first_name: "Lazy",
        last_name: "User",
      }),
    });
    expect(created.clerkId).toBe(clerkId);
    expect(created.email).toBe(`${clerkId}@example.com`);
    expect(created.name).toBe("Lazy User");

    const found = await testDb.select().from(users);
    expect(found.find((u) => u.clerkId === clerkId)).toBeDefined();
  });
});

describe("getDbUser", () => {
  test("returns the dbUser when attachDbUser has run", async () => {
    const clerkId = `clerk_helper_${randomUUID()}`;
    await testDb.insert(users).values({ clerkId, email: "helper@example.com", name: "Helper" });

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeClerkSession(clerkId));
    app.use("*", requireAuth);
    app.use("*", attachDbUser);
    app.get("/probe", (c) => {
      const u = getDbUser(c);
      return c.json({ email: u.email });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "helper@example.com" });
  });

  test("throws 500 when dbUser is missing (attachDbUser not mounted)", async () => {
    const app = new Hono<{ Variables: AuthVars }>();
    // No attachDbUser mounted on purpose.
    app.get("/probe", (c) => {
      const u = getDbUser(c);
      return c.json({ id: u.id });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(500);
  });
});
