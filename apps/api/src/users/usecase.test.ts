import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import type { IdentityProfile } from "@/ports/identity";
import { createTestDb, type TestDb } from "@/test/integration-db";
import type { ClerkUserPayload } from "./domain";
import { findUserByExternalId, insertUser } from "./repo";
import {
  applyClerkUserDelete,
  applyClerkUserUpsert,
  ensureUserByClerkId,
  getCurrentUserByClerkId,
  getUserById,
  type IdentityLookupPort,
} from "./usecase";

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
  await testDb.$client.exec(`TRUNCATE TABLE common.users RESTART IDENTITY CASCADE;`);
});

const samplePayload = (id: string): ClerkUserPayload => ({
  id,
  email_addresses: [{ id: "e1", email_address: "u@example.com" }],
  primary_email_address_id: "e1",
  first_name: "First",
  last_name: "Last",
});

/**
 * Build a fake `IdentityLookupPort` whose `getUserByExternalId` returns the
 * given profile (or the result of a builder fn). Counts invocations so tests
 * can assert that the cached path doesn't hit the identity provider.
 */
function fakeIdentityPort(
  fetcher: (externalId: string) => Promise<IdentityProfile | null>,
): IdentityLookupPort & { calls: number } {
  const port = {
    calls: 0,
    getUserByExternalId: async (externalId: string) => {
      port.calls += 1;
      return fetcher(externalId);
    },
  };
  return port;
}

describe("users/usecase (integration)", () => {
  test("getCurrentUserByClerkId returns the seeded user", async () => {
    const externalId = `c_${randomUUID()}`;
    await insertUser(db, { externalId, email: "x@x.com", name: null });

    const found = await getCurrentUserByClerkId(db, externalId);
    expect(found?.email).toBe("x@x.com");
  });

  test("getCurrentUserByClerkId returns null when missing", async () => {
    expect(await getCurrentUserByClerkId(db, "absent")).toBeNull();
  });

  test("getUserById returns by primary key", async () => {
    const externalId = `c_${randomUUID()}`;
    const u = await insertUser(db, { externalId, email: "y@y.com", name: null });
    const found = await getUserById(db, u.id);
    expect(found?.id).toBe(u.id);
  });

  test("applyClerkUserUpsert creates then updates", async () => {
    const clerkId = `c_${randomUUID()}`;
    await applyClerkUserUpsert(db, samplePayload(clerkId));
    const updatedPayload: ClerkUserPayload = {
      ...samplePayload(clerkId),
      email_addresses: [{ id: "e1", email_address: "new@example.com" }],
      first_name: "New",
    };
    await applyClerkUserUpsert(db, updatedPayload);
    const found = await findUserByExternalId(db, clerkId);
    expect(found?.email).toBe("new@example.com");
    expect(found?.name).toBe("New Last");
  });

  test("applyClerkUserDelete removes the user", async () => {
    const clerkId = `c_${randomUUID()}`;
    await applyClerkUserUpsert(db, samplePayload(clerkId));
    await applyClerkUserDelete(db, clerkId);
    expect(await findUserByExternalId(db, clerkId)).toBeNull();
  });

  test("ensureUserByClerkId returns existing user without calling identity provider", async () => {
    const externalId = `c_${randomUUID()}`;
    await insertUser(db, { externalId, email: "exist@x.com", name: "Exist" });
    const port = fakeIdentityPort(async () => ({
      externalId,
      email: "exist@x.com",
      firstName: "Exist",
      lastName: null,
    }));
    const result = await ensureUserByClerkId(db, externalId, port);
    expect(port.calls).toBe(0);
    expect(result.email).toBe("exist@x.com");
  });

  test("ensureUserByClerkId lazy-fetches from identity provider and upserts when missing", async () => {
    const clerkId = `c_${randomUUID()}`;
    const port = fakeIdentityPort(async (id) => ({
      externalId: id,
      email: "u@example.com",
      firstName: "First",
      lastName: "Last",
    }));
    const result = await ensureUserByClerkId(db, clerkId, port);
    expect(port.calls).toBe(1);
    expect(result.email).toBe("u@example.com");
    expect(result.name).toBe("First Last");
    const found = await findUserByExternalId(db, clerkId);
    expect(found?.id).toBe(result.id);
  });

  test("ensureUserByClerkId surfaces fetcher errors", async () => {
    const port = fakeIdentityPort(async () => {
      throw new Error("clerk down");
    });
    await expect(ensureUserByClerkId(db, `c_${randomUUID()}`, port)).rejects.toThrow(/clerk down/);
  });
});
