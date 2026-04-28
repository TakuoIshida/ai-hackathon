import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

process.env.CLERK_SECRET_KEY ??= "sk_test_unit_test_stub";
process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_ZXhhbXBsZS5jb20k";

const { app } = await import("@/app");
const { clearDbForTests, db, setDbForTests } = await import("@/db/client");
const { invitations } = await import("@/db/schema/workspaces");
const { tenantMembers, tenants } = await import("@/db/schema/common");
const { createTestDb } = await import("@/test/integration-db");
const { insertUser } = await import("@/users/repo");

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

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
  await testDb.$client.exec(
    `TRUNCATE TABLE tenant.invitations, common.tenant_members, common.tenants, common.users RESTART IDENTITY CASCADE;`,
  );
});

async function seedInvitation(opts?: { email?: string; expiresAt?: Date; acceptedAt?: Date }) {
  const owner = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: `owner-${randomUUID()}@x.com`,
    name: null,
  });
  const [ws] = await testDb.insert(tenants).values({ name: "Acme" }).returning();
  if (!ws) throw new Error("seed: tenant");
  await testDb.insert(tenantMembers).values({ userId: owner.id, tenantId: ws.id, role: "owner" });
  const [inv] = await testDb
    .insert(invitations)
    .values({
      tenantId: ws.id,
      email: opts?.email ?? "invitee@example.com",
      invitedByUserId: owner.id,
      expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000),
      acceptedAt: opts?.acceptedAt ?? null,
    })
    .returning();
  if (!inv) throw new Error("seed: invitation");
  return { workspace: ws, invitation: inv };
}

describe("/invitations auth gate (ISH-109)", () => {
  test("POST /invitations/:token/accept → 401 unauth", async () => {
    const res = await app.request(`/invitations/${randomUUID()}/accept`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /invitations/:token (public)", () => {
  test("returns workspace summary + email + expired flag for an open invitation", async () => {
    const { workspace, invitation } = await seedInvitation({ email: "i@example.com" });
    const res = await app.request(`/invitations/${invitation.token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: { name: workspace.name },
      email: "i@example.com",
      expired: false,
    });
  });

  test("404 when the token does not exist (and never reaches auth — public route)", async () => {
    const res = await app.request(`/invitations/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  test("expired flag is true when expiresAt is in the past", async () => {
    const { invitation } = await seedInvitation({
      expiresAt: new Date(Date.now() - 60_000),
    });
    const res = await app.request(`/invitations/${invitation.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expired: boolean };
    expect(body.expired).toBe(true);
  });

  test("expired flag is true when invitation is already accepted (no longer redeemable)", async () => {
    const { invitation } = await seedInvitation({ acceptedAt: new Date() });
    const res = await app.request(`/invitations/${invitation.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { expired: boolean };
    expect(body.expired).toBe(true);
  });
});
