import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { tenants } from "@/db/schema";
import { createTestDb, type TestDb } from "@/test/integration-db";
import { insertUser } from "@/users/repo";
import type { CreateLinkCommand } from "./domain";
import {
  createLink,
  deleteLink,
  findPublishedLinkBySlug,
  getLinkForUser,
  isSlugTaken,
  listLinkCoOwnerUserIds,
  listLinksForUser,
  setLinkCoOwners,
  updateLink,
} from "./repo";

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
    TRUNCATE TABLE tenant.bookings, tenant.link_owners, tenant.availability_excludes,
    tenant.availability_rules, tenant.availability_links, common.tenants, common.users
    RESTART IDENTITY CASCADE;
  `);
});

async function seedTenant(): Promise<string> {
  const [tenant] = await testDb.insert(tenants).values({ name: "Test Tenant" }).returning();
  if (!tenant) throw new Error("seed: tenant insert failed");
  return tenant.id;
}

async function seedUser(): Promise<string> {
  const u = await insertUser(db, {
    externalId: `c_${randomUUID()}`,
    email: "owner@example.com",
    name: null,
  });
  return u.id;
}

const baseInput = (overrides: Partial<CreateLinkCommand> = {}): CreateLinkCommand => ({
  slug: "intro-30",
  title: "30 min",
  description: null,
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  slotIntervalMinutes: null,
  maxPerDay: null,
  leadTimeHours: 0,
  rangeDays: 60,
  timeZone: "Asia/Tokyo",
  isPublished: false,
  rules: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  excludes: ["2026-12-31"],
  ...overrides,
});

describe("links/repo", () => {
  test("createLink persists link, rules, and excludes; getLinkForUser returns relations", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLink(db, userId, tenantId, baseInput());
    expect(created.slug).toBe("intro-30");
    expect(created.rules.length).toBe(1);
    expect(created.excludes).toEqual(["2026-12-31"]);

    const reloaded = await getLinkForUser(db, userId, created.id);
    expect(reloaded?.id).toBe(created.id);
  });

  test("listLinksForUser scopes by userId", async () => {
    const tenantId = await seedTenant();
    const userA = await seedUser();
    const userB = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "b@x.com",
      name: null,
    });
    await createLink(db, userA, tenantId, baseInput({ slug: "a-link" }));
    await createLink(db, userB.id, tenantId, baseInput({ slug: "b-link" }));

    const aLinks = await listLinksForUser(db, userA);
    expect(aLinks.length).toBe(1);
    expect(aLinks[0]?.slug).toBe("a-link");
  });

  test("getLinkForUser returns null when ownership does not match", async () => {
    const tenantId = await seedTenant();
    const userA = await seedUser();
    const userB = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "b@x.com",
      name: null,
    });
    const link = await createLink(db, userA, tenantId, baseInput({ slug: "owned-by-a" }));
    expect(await getLinkForUser(db, userB.id, link.id)).toBeNull();
  });

  test("isSlugTaken returns true after createLink", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    expect(await isSlugTaken(db, "intro-30")).toBe(false);
    await createLink(db, userId, tenantId, baseInput());
    expect(await isSlugTaken(db, "intro-30")).toBe(true);
  });

  test("updateLink replaces rules and excludes", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const created = await createLink(db, userId, tenantId, baseInput());
    const updated = await updateLink(db, userId, created.id, {
      title: "Renamed",
      rules: [{ weekday: 2, startMinute: 600, endMinute: 660 }],
      excludes: [],
    });
    expect(updated?.title).toBe("Renamed");
    expect(updated?.rules).toEqual([{ weekday: 2, startMinute: 600, endMinute: 660 }]);
    expect(updated?.excludes).toEqual([]);
  });

  test("updateLink returns null when link is not owned by user", async () => {
    const userId = await seedUser();
    expect(await updateLink(db, userId, randomUUID(), { title: "x" })).toBeNull();
  });

  test("deleteLink returns false when nothing matched, true otherwise", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    expect(await deleteLink(db, userId, randomUUID())).toBe(false);
    const link = await createLink(db, userId, tenantId, baseInput());
    expect(await deleteLink(db, userId, link.id)).toBe(true);
    expect(await getLinkForUser(db, userId, link.id)).toBeNull();
  });

  test("findPublishedLinkBySlug requires isPublished=true", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const draft = await createLink(
      db,
      userId,
      tenantId,
      baseInput({ slug: "draft", isPublished: false }),
    );
    expect(await findPublishedLinkBySlug(db, "draft")).toBeNull();
    await updateLink(db, userId, draft.id, { isPublished: true });
    const found = await findPublishedLinkBySlug(db, "draft");
    expect(found?.id).toBe(draft.id);
  });
});

describe("links/repo: link co-owners (ISH-112)", () => {
  test("listLinkCoOwnerUserIds returns [] when no co-owners", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const link = await createLink(db, userId, tenantId, baseInput({ slug: "no-co" }));
    expect(await listLinkCoOwnerUserIds(db, link.id)).toEqual([]);
  });

  test("setLinkCoOwners persists co-owners and dedupes", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const link = await createLink(db, userId, tenantId, baseInput({ slug: "co-1" }));
    const u2 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    const u3 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u3@x.com",
      name: null,
    });
    await setLinkCoOwners(db, link, [u2.id, u3.id, u2.id]);
    const co = await listLinkCoOwnerUserIds(db, link.id);
    expect(co.sort()).toEqual([u2.id, u3.id].sort());
  });

  test("setLinkCoOwners filters out the primary user silently", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const link = await createLink(db, userId, tenantId, baseInput({ slug: "co-2" }));
    const u2 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    await setLinkCoOwners(db, link, [userId, u2.id]);
    expect(await listLinkCoOwnerUserIds(db, link.id)).toEqual([u2.id]);
  });

  test("setLinkCoOwners replaces existing set on each call", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const link = await createLink(db, userId, tenantId, baseInput({ slug: "co-3" }));
    const u2 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    const u3 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u3@x.com",
      name: null,
    });
    await setLinkCoOwners(db, link, [u2.id]);
    await setLinkCoOwners(db, link, [u3.id]);
    expect(await listLinkCoOwnerUserIds(db, link.id)).toEqual([u3.id]);
  });

  test("setLinkCoOwners with empty array clears all co-owners", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const link = await createLink(db, userId, tenantId, baseInput({ slug: "co-4" }));
    const u2 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    await setLinkCoOwners(db, link, [u2.id]);
    await setLinkCoOwners(db, link, []);
    expect(await listLinkCoOwnerUserIds(db, link.id)).toEqual([]);
  });

  test("deleting the link cascades link_owners rows", async () => {
    const tenantId = await seedTenant();
    const userId = await seedUser();
    const link = await createLink(db, userId, tenantId, baseInput({ slug: "co-5" }));
    const u2 = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "u2@x.com",
      name: null,
    });
    await setLinkCoOwners(db, link, [u2.id]);
    await deleteLink(db, userId, link.id);
    expect(await listLinkCoOwnerUserIds(db, link.id)).toEqual([]);
  });
});
