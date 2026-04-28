import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenantMembers, tenants } from "@/db/schema/common";
import { invitations } from "@/db/schema/tenant";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { acceptInvitation, createInvitation } from "./usecase";

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

async function seedUser(email = `u-${randomUUID()}@x.com`) {
  return insertUser(db, { externalId: `c_${randomUUID()}`, email, name: null });
}

async function seedTenant(ownerUserId: string) {
  const [tenant] = await testDb
    .insert(tenants)
    .values({ name: `Tenant-${randomUUID()}` })
    .returning();
  if (!tenant) throw new Error("seed: tenant insert failed");
  await testDb
    .insert(tenantMembers)
    .values({ userId: ownerUserId, tenantId: tenant.id, role: "owner" });
  return tenant;
}

// ---------------------------------------------------------------------------
// createInvitation tests
// ---------------------------------------------------------------------------

describe("invitations/usecase: createInvitation (ISH-176)", () => {
  test("happy path: inserts invitation and returns ok with token", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);

    const result = await createInvitation(db, tenant.id, owner.id, {
      email: "invitee@example.com",
      role: "member",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.invitationId).toBeDefined();
    expect(result.token).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 shape
    expect(result.expiresAt).toBeInstanceOf(Date);
    // expiresAt should be ~7 days from now
    const sevenDaysMs = 7 * 24 * 60 * 60_000;
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + sevenDaysMs - 5000);
    expect(result.expiresAt.getTime()).toBeLessThan(Date.now() + sevenDaysMs + 5000);
  });

  test("already_invited: returns already_invited when an open invitation exists for the email", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);

    // Issue first invitation
    const first = await createInvitation(db, tenant.id, owner.id, {
      email: "invitee@example.com",
      role: "member",
    });
    expect(first.kind).toBe("ok");

    // Attempt a second invitation for the same email
    const second = await createInvitation(db, tenant.id, owner.id, {
      email: "invitee@example.com",
      role: "member",
    });
    expect(second.kind).toBe("already_invited");
  });

  test("already_member: returns already_member when the email belongs to an existing tenant member", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);
    // Owner's email is already a member — try to invite them
    const result = await createInvitation(db, tenant.id, owner.id, {
      email: owner.email,
      role: "member",
    });
    expect(result.kind).toBe("already_member");
  });
});

// ---------------------------------------------------------------------------
// acceptInvitation tests
// ---------------------------------------------------------------------------

describe("invitations/usecase: acceptInvitation (ISH-176)", () => {
  async function seedInvitation(opts?: {
    email?: string;
    expiresAt?: Date;
    acceptedAt?: Date | null;
  }) {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);
    const [inv] = await testDb
      .insert(invitations)
      .values({
        tenantId: tenant.id,
        email: opts?.email ?? "invitee@example.com",
        invitedByUserId: owner.id,
        expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000),
        acceptedAt: opts?.acceptedAt ?? null,
      })
      .returning();
    if (!inv) throw new Error("seed: invitation insert failed");
    return { tenant, owner, invitation: inv };
  }

  test("happy path: creates tenant_members row and marks invitation accepted", async () => {
    const inviteeEmail = "invitee@example.com";
    const { invitation, tenant } = await seedInvitation({ email: inviteeEmail });
    const invitee = await seedUser(inviteeEmail);

    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.tenantId).toBe(tenant.id);
    expect(result.role).toBe("member");

    // Verify invitee is now a tenant member
    const [member] = await testDb
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, invitee.id));
    expect(member).toBeDefined();
    expect(member?.tenantId).toBe(tenant.id);
    expect(member?.role).toBe("member");

    // Verify invitation is marked accepted
    const [inv] = await testDb.select().from(invitations).where(eq(invitations.id, invitation.id));
    expect(inv?.acceptedAt).not.toBeNull();
  });

  test("not_found: returns not_found for an unknown token", async () => {
    const invitee = await seedUser();
    const result = await acceptInvitation(db, invitee.id, invitee.email, randomUUID());
    expect(result.kind).toBe("not_found");
  });

  test("expired: returns expired (410) when invitation is past expires_at", async () => {
    const inviteeEmail = "invitee@example.com";
    const { invitation } = await seedInvitation({
      email: inviteeEmail,
      expiresAt: new Date(Date.now() - 1000), // 1 second in the past
    });
    const invitee = await seedUser(inviteeEmail);
    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("expired");
  });

  test("already_accepted: returns already_accepted (409) when invitation was previously accepted", async () => {
    const inviteeEmail = "invitee@example.com";
    const { invitation } = await seedInvitation({
      email: inviteeEmail,
      acceptedAt: new Date(),
    });
    const invitee = await seedUser(inviteeEmail);
    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("already_accepted");
  });

  test("email_mismatch: returns email_mismatch (403) when caller email differs from invitation email", async () => {
    const { invitation } = await seedInvitation({ email: "correct@example.com" });
    const wrongUser = await seedUser("wrong@example.com");
    const result = await acceptInvitation(db, wrongUser.id, wrongUser.email, invitation.token);
    expect(result.kind).toBe("email_mismatch");
  });

  test("user_already_in_tenant: returns user_already_in_tenant (409) when caller is already a tenant member", async () => {
    const inviteeEmail = "invitee@example.com";
    const { invitation } = await seedInvitation({ email: inviteeEmail });
    // Create invitee user already belonging to another tenant
    const invitee = await seedUser(inviteeEmail);
    const [otherTenant] = await testDb.insert(tenants).values({ name: "Other Tenant" }).returning();
    if (!otherTenant) throw new Error("seed: other tenant");
    await testDb.insert(tenantMembers).values({
      userId: invitee.id,
      tenantId: otherTenant.id,
      role: "member",
    });

    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("user_already_in_tenant");
  });
});
