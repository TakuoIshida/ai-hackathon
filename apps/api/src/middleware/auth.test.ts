import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import postgres from "postgres";
import { clearDbForTests, setDbForTests } from "@/db/client";
import { tenantMembers, tenants, users } from "@/db/schema";
import {
  type AuthVars,
  attachDbUser,
  attachTenantContext,
  getClerkUserId,
  getDbUser,
  requireAuth,
} from "@/middleware/auth";
import type { IdentityClaims } from "@/ports/identity";
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
    TRUNCATE TABLE tenant.bookings, tenant.availability_rules,
    tenant.availability_links, tenant.google_calendars, tenant.google_oauth_accounts,
    common.tenant_members, common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

/**
 * Mints a fake identity session by setting the `identityClaims` context
 * variable that `requireAuth` / `getClerkUserId` / `attachDbUser` read.
 * Mirrors what `attachAuth` does after running the vendor middleware and
 * resolving claims via `idp.getClaims(c)`.
 */
function fakeIdentitySession(userId: string | null, email = "test@example.com"): MiddlewareHandler {
  return async (c, next) => {
    if (userId) {
      const claims: IdentityClaims = { externalId: userId, email, emailVerified: true };
      c.set("identityClaims", claims as never);
    }
    // When userId is null we don't set identityClaims — mirrors an unauthenticated request.
    await next();
  };
}

describe("requireAuth", () => {
  test("calls next() when identity claims are present", async () => {
    const app = new Hono();
    app.use("*", fakeIdentitySession("user_abc"));
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

  test("returns 401 when identity claims are absent (null userId)", async () => {
    const app = new Hono();
    app.use("*", fakeIdentitySession(null));
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

  test("returns 401 when no identity middleware ran (no identityClaims var set)", async () => {
    const app = new Hono();
    app.use("*", requireAuth);
    app.get("/probe", (c) => c.json({ ok: true }));

    const res = await app.request("/probe");
    expect(res.status).toBe(401);
  });
});

describe("getClerkUserId", () => {
  test("returns the externalId when identity claims are set", async () => {
    const app = new Hono();
    app.use("*", fakeIdentitySession("user_xyz"));
    const captured: { value: string | null } = { value: null };
    app.get("/probe", (c) => {
      captured.value = getClerkUserId(c);
      return c.json({ id: captured.value });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    expect(captured.value).toBe("user_xyz");
  });

  test("throws 401 HTTPException when no claims are present", async () => {
    const app = new Hono();
    // No fakeIdentitySession — getClerkUserId should throw
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
    const externalId = `clerk_existing_${randomUUID()}`;
    const [seeded] = await testDb
      .insert(users)
      .values({ externalId, email: "existing@example.com", name: "Existing" })
      .returning();
    if (!seeded) throw new Error("seed failed");

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeIdentitySession(externalId, "existing@example.com"));
    app.use("*", requireAuth);
    app.use("*", attachDbUser);
    app.get("/probe", (c) => {
      const u = getDbUser(c);
      return c.json({ id: u.id, externalId: u.externalId, email: u.email, name: u.name });
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      externalId: string;
      email: string;
      name: string;
    };
    expect(body.id).toBe(seeded.id);
    expect(body.externalId).toBe(externalId);
    expect(body.email).toBe("existing@example.com");
    expect(body.name).toBe("Existing");
  });

  test("auto-creates the user via identity provider fetch when not in DB (current behavior pin)", async () => {
    // attachDbUser → ensureUserByClerkId → if missing, calls getUserByExternalId.
    // Here we have no real Clerk available, so the lazy fetch will fail.
    // We assert: (a) there was no row before, (b) the request errors out (NOT
    // silently logs in as an empty user), (c) no row was created
    // (ensureUserByClerkId only inserts after a successful identity payload).
    const externalId = `clerk_missing_${randomUUID()}`;

    const before = await testDb.select().from(users);
    expect(before.find((u) => u.externalId === externalId)).toBeUndefined();

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeIdentitySession(externalId));
    app.use("*", requireAuth);
    app.use("*", attachDbUser);
    app.get("/probe", (c) => c.json({ id: getDbUser(c).id }));
    // Treat any thrown error as 500 so the request resolves rather than
    // rejecting the test. The CLERK_SECRET_KEY stub is not a real key, so
    // Clerk's API call will reject.
    app.onError((_err, c) => c.json({ error: "boom" }, 500));

    const res = await app.request("/probe");
    // We don't pin the exact status — only that it does NOT silently 200.
    // What we DO pin: no user row was created with this externalId, since
    // ensureUserByClerkId only inserts after a successful identity payload.
    expect(res.status).not.toBe(200);

    const after = await testDb.select().from(users);
    expect(after.find((u) => u.externalId === externalId)).toBeUndefined();
  });

  test("auto-creates the user when getUserByExternalId is provided (happy lazy-create path)", async () => {
    // Direct unit-call into ensureUserByClerkId to pin the behavior
    // attachDbUser inherits: lazy-create from an identity profile.
    const { ensureUserByClerkId } = await import("@/users/usecase");
    const clerkId = `clerk_lazy_${randomUUID()}`;

    const created = await ensureUserByClerkId(testDb as never, clerkId, {
      getUserByExternalId: async (id) => ({
        externalId: id,
        email: `${id}@example.com`,
        firstName: "Lazy",
        lastName: "User",
      }),
    });
    expect(created.externalId).toBe(clerkId);
    expect(created.email).toBe(`${clerkId}@example.com`);
    expect(created.name).toBe("Lazy User");

    const found = await testDb.select().from(users);
    expect(found.find((u) => u.externalId === clerkId)).toBeDefined();
  });
});

describe("getDbUser", () => {
  test("returns the dbUser when attachDbUser has run", async () => {
    const externalId = `clerk_helper_${randomUUID()}`;
    await testDb.insert(users).values({ externalId, email: "helper@example.com", name: "Helper" });

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeIdentitySession(externalId, "helper@example.com"));
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

// ---------------------------------------------------------------------------
// attachTenantContext tests (ISH-171)
// ---------------------------------------------------------------------------

describe("attachTenantContext", () => {
  /**
   * Helper: inserts a user + tenant + tenant_members row (using the test DB
   * superuser connection which bypasses RLS) and returns a fake-auth middleware
   * that sets both identityClaims and dbUser on the context.
   */
  async function seedUserWithTenant(): Promise<{
    externalId: string;
    tenantId: string;
    fakeAuth: MiddlewareHandler;
  }> {
    const externalId = `clerk_tenant_${randomUUID()}`;
    const email = `tenant-${randomUUID()}@example.com`;

    const [user] = await testDb
      .insert(users)
      .values({ externalId, email, name: "Tenant User" })
      .returning();
    if (!user) throw new Error("seed user failed");

    const [tenant] = await testDb.insert(tenants).values({ name: "Test Org" }).returning();
    if (!tenant) throw new Error("seed tenant failed");

    await testDb
      .insert(tenantMembers)
      .values({ userId: user.id, tenantId: tenant.id, role: "owner" });

    const fakeAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
      const claims: IdentityClaims = { externalId, email, emailVerified: true };
      c.set("identityClaims", claims as never);
      c.set("dbUser", user as never);
      await next();
    };

    return { externalId, tenantId: tenant.id, fakeAuth };
  }

  test("sets tenantId on context and calls next() when user has a tenant", async () => {
    const { tenantId, fakeAuth } = await seedUserWithTenant();

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeAuth);
    app.use("*", attachTenantContext);
    app.get("/probe", (c) => {
      return c.json({ tenantId: c.get("tenantId") });
    });
    app.onError((err, c) => c.json({ error: String(err) }, 500));

    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: string };
    expect(body.tenantId).toBe(tenantId);
  });

  // ISH-276: lookup must run inside the request transaction with FOR SHARE so
  // a concurrent revoke (DELETE FROM common.tenant_members WHERE user_id=X)
  // is blocked until the request commits. This guards against the previous
  // TOCTOU window where revoke would not affect the in-flight request's RLS.
  test("ISH-276: concurrent DELETE on tenant_members blocks until request tx commits", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL not set");

    const { tenantId, fakeAuth } = await seedUserWithTenant();

    // Independent second connection — emulates an owner-initiated revoke
    // running on a different DB session in parallel with the in-flight request.
    const noVerify = new URL(url).searchParams.get("sslmode") === "no-verify";
    const sideSql = postgres(url, {
      max: 1,
      idle_timeout: 5,
      prepare: false,
      ...(noVerify ? { ssl: { rejectUnauthorized: false } } : {}),
    });

    let releaseHandler!: () => void;
    const handlerWaiter = new Promise<void>((r) => {
      releaseHandler = r;
    });
    let requestEnteredScope = false;
    let requestExitedScope = false;
    let deleteCompletedAt = 0;
    let requestCompletedAt = 0;

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeAuth);
    app.use("*", attachTenantContext);
    app.get("/probe", async (c) => {
      requestEnteredScope = true;
      // Hold the request transaction open until the test releases us. The
      // FOR SHARE lock acquired by attachTenantContext on the
      // tenant_members row is held for the duration of this transaction.
      await handlerWaiter;
      requestExitedScope = true;
      return c.json({ tenantId: c.get("tenantId") });
    });
    app.onError((err, c) => c.json({ error: String(err) }, 500));

    try {
      // Kick off the request — it will block inside the handler holding the lock.
      const requestPromise = (async () => {
        const res = await app.request("/probe");
        requestCompletedAt = Date.now();
        return res;
      })();

      // Wait for the handler to actually be in-flight (lock acquired).
      while (!requestEnteredScope) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Now race a DELETE on a separate connection. Because the request tx
      // holds FOR SHARE on the tenant_members row, the DELETE must wait until
      // the request tx commits.
      const deletePromise = sideSql`
        DELETE FROM common.tenant_members WHERE tenant_id = ${tenantId}
      `.then(() => {
        deleteCompletedAt = Date.now();
      });

      // Give the DELETE a beat to attempt — it should be blocked, not progress.
      await new Promise((r) => setTimeout(r, 200));
      expect(deleteCompletedAt).toBe(0);
      expect(requestExitedScope).toBe(false);

      // Release the request handler — the request tx commits, the FOR SHARE
      // lock releases, and the DELETE proceeds.
      releaseHandler();

      const res = await requestPromise;
      await deletePromise;

      expect(res.status).toBe(200);
      expect(requestExitedScope).toBe(true);
      // DELETE must complete strictly after the request tx commits.
      expect(deleteCompletedAt).toBeGreaterThanOrEqual(requestCompletedAt);
    } finally {
      await sideSql.end({ timeout: 5 });
    }
  }, 15_000);

  test("returns 403 when user has no tenant_members row", async () => {
    const externalId = `clerk_notenant_${randomUUID()}`;
    const [user] = await testDb
      .insert(users)
      .values({ externalId, email: `nt-${randomUUID()}@example.com`, name: "No Tenant" })
      .returning();
    if (!user) throw new Error("seed user failed");

    const fakeAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (c, next) => {
      const claims: IdentityClaims = {
        externalId,
        email: user.email,
        emailVerified: true,
      };
      c.set("identityClaims", claims as never);
      c.set("dbUser", user as never);
      await next();
    };

    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeAuth);
    app.use("*", attachTenantContext);
    app.get("/probe", (c) => c.json({ ok: true }));
    app.onError((err, c) => {
      const status = "status" in err ? (err as { status: number }).status : 500;
      return c.json({ error: "err" }, status as 403);
    });

    const res = await app.request("/probe");
    expect(res.status).toBe(403);
  });
});
