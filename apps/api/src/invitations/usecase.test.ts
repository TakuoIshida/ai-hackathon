import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenantMembers, tenants } from "@/db/schema/common";
import { invitations } from "@/db/schema/tenant";
import type { EmailMessage, SendEmailFn } from "@/notifications/types";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import { acceptInvitation, createInvitation, resendTenantInvitation } from "./usecase";

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

  test("ISH-195: case-insensitive — second invite with different casing is rejected as already_invited", async () => {
    // Bob@x.com の招待を発行 → 大文字違いの bob@x.com で再発行を試みる
    // → uniqueness check で already_invited が返る (insert 時 lowercase 正規化により)。
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);

    const first = await createInvitation(db, tenant.id, owner.id, {
      email: "Bob@Example.COM",
      role: "member",
    });
    expect(first.kind).toBe("ok");

    const second = await createInvitation(db, tenant.id, owner.id, {
      email: "bob@example.com",
      role: "member",
    });
    expect(second.kind).toBe("already_invited");
  });

  test("ISH-195: case-insensitive — already_member detection ignores casing", async () => {
    // 既存 member の email が大文字 → 招待時の email を小文字で投入しても
    // already_member を検出する。
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);
    // Seed member with mixed-case email
    const member = await seedUser("Charlie@Example.COM".toLowerCase());
    await testDb
      .insert(tenantMembers)
      .values({ userId: member.id, tenantId: tenant.id, role: "member" });

    const result = await createInvitation(db, tenant.id, owner.id, {
      email: "CHARLIE@example.com",
      role: "member",
    });
    expect(result.kind).toBe("already_member");
  });

  test("ISH-195: invitation row is stored with lowercase email", async () => {
    // The schema-level partial unique index `uniq_tenant_email_open` is case-
    // sensitive (text equality). Storing the lowercase form keeps the
    // constraint effective regardless of how the inviter typed the email.
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);

    const result = await createInvitation(db, tenant.id, owner.id, {
      email: "Mixed@CASE.com",
      role: "member",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const row = await testDb
      .select({ email: invitations.email })
      .from(invitations)
      .where(eq(invitations.id, result.invitationId))
      .limit(1);
    expect(row[0]?.email).toBe("mixed@case.com");
  });

  test("ISH-252: persists role='member' on the invitation row", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);

    const result = await createInvitation(db, tenant.id, owner.id, {
      email: "member-invite@example.com",
      role: "member",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const row = await testDb
      .select({ role: invitations.role })
      .from(invitations)
      .where(eq(invitations.id, result.invitationId))
      .limit(1);
    expect(row[0]?.role).toBe("member");
  });

  test("ISH-252: persists role='owner' on the invitation row", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);

    const result = await createInvitation(db, tenant.id, owner.id, {
      email: "owner-invite@example.com",
      role: "owner",
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const row = await testDb
      .select({ role: invitations.role })
      .from(invitations)
      .where(eq(invitations.id, result.invitationId))
      .limit(1);
    expect(row[0]?.role).toBe("owner");
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
    role?: "owner" | "member";
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
        role: opts?.role ?? "member",
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

  test("ISH-252: owner-role invitation creates an owner tenant_members row on accept", async () => {
    const inviteeEmail = "new-owner@example.com";
    const { invitation, tenant } = await seedInvitation({
      email: inviteeEmail,
      role: "owner",
    });
    const invitee = await seedUser(inviteeEmail);

    const result = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.tenantId).toBe(tenant.id);
    expect(result.role).toBe("owner");

    const [member] = await testDb
      .select()
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, invitee.id));
    expect(member?.role).toBe("owner");
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

  test("email_mismatch is collapsed to not_found (ISH-194: don't leak token liveness)", async () => {
    // The wrong-email caller must not learn anything more than someone who
    // submitted a totally bogus token. Both → 404 not_found.
    const { invitation } = await seedInvitation({ email: "correct@example.com" });
    const wrongUser = await seedUser("wrong@example.com");
    const result = await acceptInvitation(db, wrongUser.id, wrongUser.email, invitation.token);
    expect(result.kind).toBe("not_found");
  });

  test("error precedence: expired > email-mismatch (an expired invite for the wrong user surfaces expired, not not_found)", async () => {
    // Pin the order so a future refactor doesn't put email check first
    // (regression to the leak path).
    const { invitation } = await seedInvitation({ email: "correct@example.com" });
    // Force expiry into the past via a direct UPDATE.
    await testDb.execute(
      sql`UPDATE tenant.invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = ${invitation.id}`,
    );
    const wrongUser = await seedUser("wrong@example.com");
    const result = await acceptInvitation(db, wrongUser.id, wrongUser.email, invitation.token);
    expect(result.kind).toBe("expired");
  });

  test("error precedence: already_accepted > email-mismatch", async () => {
    const inviteeEmail = "invitee@example.com";
    const { invitation } = await seedInvitation({ email: inviteeEmail });
    const invitee = await seedUser(inviteeEmail);
    // First accept (legit) — sets accepted_at.
    const first = await acceptInvitation(db, invitee.id, invitee.email, invitation.token);
    expect(first.kind).toBe("ok");
    // Second attempt with the wrong email must surface already_accepted, not
    // not_found — pin the precedence so the email check stays last.
    const wrongUser = await seedUser("wrong@example.com");
    const result = await acceptInvitation(db, wrongUser.id, wrongUser.email, invitation.token);
    expect(result.kind).toBe("already_accepted");
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

// ---------------------------------------------------------------------------
// resendTenantInvitation tests (ISH-261)
// ---------------------------------------------------------------------------

describe("invitations/usecase: resendTenantInvitation (ISH-261)", () => {
  function captureEmails(): { fn: SendEmailFn; sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
      sent,
      fn: async (msg) => {
        sent.push(msg);
      },
    };
  }

  const baseDeps = (sendEmail: SendEmailFn = async () => {}) => ({
    sendEmail,
    appBaseUrl: "https://app.test",
  });

  async function seedOpenInvitation(opts?: {
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
        role: "member",
      })
      .returning();
    if (!inv) throw new Error("seed: invitation insert failed");
    return { tenant, owner, invitation: inv };
  }

  test("happy path: extends expiresAt by 24h and triggers email send", async () => {
    const { tenant, invitation } = await seedOpenInvitation({
      email: "resend@example.com",
      // Original expiry well in the past so we can verify it was bumped to ~now+24h.
      expiresAt: new Date(Date.now() - 60_000),
    });
    const cap = captureEmails();
    const fixedNow = Date.parse("2026-05-07T00:00:00.000Z");
    const result = await resendTenantInvitation(db, tenant.id, invitation.id, {
      ...baseDeps(cap.fn),
      now: () => fixedNow,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.expiresAt.getTime()).toBe(fixedNow + 24 * 60 * 60_000);

    // DB row was updated
    const [row] = await testDb
      .select({ expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(row?.expiresAt.getTime()).toBe(fixedNow + 24 * 60 * 60_000);

    // One email captured, body carries the original token + accept link
    expect(cap.sent.length).toBe(1);
    expect(cap.sent[0]?.to).toBe("resend@example.com");
    expect(cap.sent[0]?.text).toContain(invitation.token);
    expect(cap.sent[0]?.text).toContain("https://app.test/invite/");
  });

  test("not_found when the invitation id does not exist for the tenant", async () => {
    const owner = await seedUser();
    const tenant = await seedTenant(owner.id);
    const cap = captureEmails();
    const result = await resendTenantInvitation(
      db,
      tenant.id,
      `01J${randomUUID()}`.slice(0, 26),
      baseDeps(cap.fn),
    );
    expect(result.kind).toBe("not_found");
    expect(cap.sent.length).toBe(0);
  });

  test("not_found when the invitation belongs to a different tenant (cross-tenant probe)", async () => {
    const { invitation } = await seedOpenInvitation();
    // Issue from the perspective of an unrelated tenant.
    const otherOwner = await seedUser();
    const otherTenant = await seedTenant(otherOwner.id);
    const cap = captureEmails();
    const result = await resendTenantInvitation(
      db,
      otherTenant.id,
      invitation.id,
      baseDeps(cap.fn),
    );
    expect(result.kind).toBe("not_found");
    expect(cap.sent.length).toBe(0);
  });

  test("already_accepted when invitation has been accepted (row preserved for audit)", async () => {
    const { tenant, invitation } = await seedOpenInvitation({ acceptedAt: new Date() });
    const originalExpiresAt = invitation.expiresAt;
    const cap = captureEmails();
    const result = await resendTenantInvitation(db, tenant.id, invitation.id, baseDeps(cap.fn));
    expect(result.kind).toBe("already_accepted");
    expect(cap.sent.length).toBe(0);

    // Row must be untouched.
    const [row] = await testDb
      .select({ expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(row?.expiresAt.getTime()).toBe(originalExpiresAt.getTime());
  });

  test("commits expiry extension even if email send throws (best-effort delivery)", async () => {
    const { tenant, invitation } = await seedOpenInvitation();
    const fixedNow = Date.parse("2026-05-07T12:00:00.000Z");
    const result = await resendTenantInvitation(db, tenant.id, invitation.id, {
      sendEmail: async () => {
        throw new Error("smtp down");
      },
      appBaseUrl: "https://app.test",
      now: () => fixedNow,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.expiresAt.getTime()).toBe(fixedNow + 24 * 60 * 60_000);

    const [row] = await testDb
      .select({ expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(row?.expiresAt.getTime()).toBe(fixedNow + 24 * 60 * 60_000);
  });

  test("expired (but unaccepted) invitation can still be resent — bumps expiresAt forward", async () => {
    // Pin the original past-expiry to verify we always overwrite to now+24h.
    const { tenant, invitation } = await seedOpenInvitation({
      expiresAt: new Date(Date.now() - 30 * 60_000),
    });
    const fixedNow = Date.parse("2026-05-07T00:00:00.000Z");
    const result = await resendTenantInvitation(db, tenant.id, invitation.id, {
      ...baseDeps(),
      now: () => fixedNow,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.expiresAt.getTime()).toBe(fixedNow + 24 * 60 * 60_000);
  });
});
