/**
 * ISH-183 (Q-3): cross-tenant 取得試行は 404 を返す。
 *
 * 設計上の保証は (1) attachTenantContext が SET LOCAL app.tenant_id をかける、
 * (2) tenant schema の RLS が現在 context 以外の行を hide する、(3) repo が
 * その結果として null を返し、route が 404 を返す、の連鎖で成り立つ。
 *
 * 個別 layer は ISH-181 (RLS coverage) と middleware/auth.test.ts でカバー
 * 済だが、**route → middleware → RLS → repo → route の full stack** で
 * 「Tenant A の認証ユーザが Tenant B のリソース URL を踏むと 404」 を
 * end-to-end で pin するのが本 test の責務。
 *
 * Linear issue は Playwright を指示するが、cross-tenant security boundary は
 * API/DB 層が本質。Playwright だと multi-user shim + DB seed の追加コストが
 * 大きく、UI assertion 自体には security 価値がない (404 は 404)。本 test は
 * 同等のカバレッジを bun test の数百ミリ秒で得る pragmatic 実装。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { ulid } from "ulidx";
import { clearDbForTests, setDbForTests } from "@/db/client";
import { availabilityLinks, tenantMembers, tenants, users } from "@/db/schema";
import type { AuthVars } from "@/middleware/auth";
import type { IdentityClaims } from "@/ports/identity";
import { linksRoute } from "@/routes/links";
import { tenantMembersRoute } from "@/routes/tenant.members";
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
    TRUNCATE TABLE tenant.bookings, tenant.availability_excludes, tenant.availability_rules,
    tenant.availability_links, tenant.google_calendars, tenant.google_oauth_accounts,
    tenant.invitations, tenant.link_owners,
    common.tenant_members, common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

/**
 * Identity injection middleware — sets identityClaims on the context exactly
 * the way `attachAuth` would after running the vendor middleware. Lets us
 * exercise the real `requireAuth` / `attachDbUser` / `attachTenantContext`
 * stack without standing up a real Clerk session.
 */
function fakeIdentitySession(externalId: string, email: string): MiddlewareHandler {
  return async (c, next) => {
    const claims: IdentityClaims = { externalId, email, emailVerified: true };
    c.set("identityClaims", claims as never);
    await next();
  };
}

/**
 * Seeds 2 tenants, each with one owner user and one published availability
 * link. Returns ids so cross-tenant URL assertions can name the "other"
 * tenant's resource explicitly.
 */
async function seedTwoTenants(): Promise<{
  tenantA: { id: string; ownerExtId: string; ownerEmail: string; linkId: string };
  tenantB: { id: string; ownerExtId: string; ownerEmail: string; linkId: string };
}> {
  const ta = ulid();
  const tb = ulid();
  const ua = ulid();
  const ub = ulid();
  const linkA = ulid();
  const linkB = ulid();
  const extA = `clerk_${randomUUID()}`;
  const extB = `clerk_${randomUUID()}`;
  const emailA = `owner-a-${randomUUID()}@example.com`;
  const emailB = `owner-b-${randomUUID()}@example.com`;

  await testDb.insert(tenants).values([
    { id: ta, name: "Tenant A" },
    { id: tb, name: "Tenant B" },
  ]);
  await testDb.insert(users).values([
    { id: ua, externalId: extA, email: emailA, name: "Owner A" },
    { id: ub, externalId: extB, email: emailB, name: "Owner B" },
  ]);
  await testDb.insert(tenantMembers).values([
    { userId: ua, tenantId: ta, role: "owner" },
    { userId: ub, tenantId: tb, role: "owner" },
  ]);
  await testDb.insert(availabilityLinks).values([
    {
      id: linkA,
      tenantId: ta,
      userId: ua,
      slug: `link-a-${randomUUID().slice(0, 6).toLowerCase()}`,
      title: "Link A",
      durationMinutes: 30,
      timeZone: "Asia/Tokyo",
      isPublished: true,
    },
    {
      id: linkB,
      tenantId: tb,
      userId: ub,
      slug: `link-b-${randomUUID().slice(0, 6).toLowerCase()}`,
      title: "Link B",
      durationMinutes: 30,
      timeZone: "Asia/Tokyo",
      isPublished: true,
    },
  ]);

  return {
    tenantA: { id: ta, ownerExtId: extA, ownerEmail: emailA, linkId: linkA },
    tenantB: { id: tb, ownerExtId: extB, ownerEmail: emailB, linkId: linkB },
  };
}

function buildAppAs(externalId: string, email: string): Hono<{ Variables: AuthVars }> {
  const app = new Hono<{ Variables: AuthVars }>();
  // Mount fake identity BEFORE the route so the route's per-route requireAuth
  // / attachDbUser / attachTenantContext stack runs against a known caller.
  app.use("*", fakeIdentitySession(externalId, email));
  app.route("/links", linksRoute);
  return app;
}

describe("cross-tenant access — full stack 404 (ISH-183)", () => {
  test("baseline: own-tenant GET /links/:id → 200 (sanity check, RLS does not over-block)", async () => {
    const seed = await seedTwoTenants();
    const app = buildAppAs(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail);

    const res = await app.request(`/links/${seed.tenantA.linkId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: { id: string; title: string } };
    expect(body.link.id).toBe(seed.tenantA.linkId);
    expect(body.link.title).toBe("Link A");
  });

  test("Tenant A user → GET /links/{tenantBLinkId} returns 404 (link invisible under A's RLS context)", async () => {
    const seed = await seedTwoTenants();
    const app = buildAppAs(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail);

    const res = await app.request(`/links/${seed.tenantB.linkId}`);
    expect(res.status).toBe(404);
  });

  test("Tenant A user → PATCH /links/{tenantBLinkId} returns 404 (RLS hides B's row from UPDATE target)", async () => {
    const seed = await seedTwoTenants();
    const app = buildAppAs(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail);

    const res = await app.request(`/links/${seed.tenantB.linkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "pwned" }),
    });
    expect(res.status).toBe(404);

    // Confirm tenant B's link is untouched (admin-bypass read).
    const rows = await testDb.select().from(availabilityLinks);
    const bRow = rows.find((r) => r.id === seed.tenantB.linkId);
    expect(bRow?.title).toBe("Link B");
  });

  test("Tenant A user → DELETE /links/{tenantBLinkId} returns 404 and B's row remains", async () => {
    const seed = await seedTwoTenants();
    const app = buildAppAs(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail);

    const res = await app.request(`/links/${seed.tenantB.linkId}`, { method: "DELETE" });
    expect(res.status).toBe(404);

    const rows = await testDb.select().from(availabilityLinks);
    const bRow = rows.find((r) => r.id === seed.tenantB.linkId);
    expect(bRow).toBeDefined();
  });

  test("Tenant A user → GET /links/{tenantBLinkId}/owners returns 404 (route returns 404 when link is invisible)", async () => {
    const seed = await seedTwoTenants();
    const app = buildAppAs(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail);

    const res = await app.request(`/links/${seed.tenantB.linkId}/owners`);
    expect(res.status).toBe(404);
  });

  test("Tenant A user → GET /links (list) only returns own tenant's links (no B leakage)", async () => {
    const seed = await seedTwoTenants();
    const app = buildAppAs(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail);

    const res = await app.request(`/links`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: Array<{ id: string }> };
    const ids = body.links.map((l) => l.id);
    expect(ids).toContain(seed.tenantA.linkId);
    expect(ids).not.toContain(seed.tenantB.linkId);
  });

  // ISH-250: tenant-scoped members listing.
  test("Tenant A user → GET /tenant/members only returns own tenant members (no B leakage)", async () => {
    const seed = await seedTwoTenants();
    const app = new Hono<{ Variables: AuthVars }>();
    app.use("*", fakeIdentitySession(seed.tenantA.ownerExtId, seed.tenantA.ownerEmail));
    app.route("/tenant/members", tenantMembersRoute);

    const res = await app.request("/tenant/members");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: Array<{ email: string }>;
      callerRole: string;
    };
    const emails = body.members.map((m) => m.email);
    expect(emails).toContain(seed.tenantA.ownerEmail);
    expect(emails).not.toContain(seed.tenantB.ownerEmail);
    expect(body.callerRole).toBe("owner");
  });
});
