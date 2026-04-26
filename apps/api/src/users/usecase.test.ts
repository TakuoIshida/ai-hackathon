import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { createTestDb, type TestDb } from "@/test/integration-db";
import type { ClerkUserPayload } from "./domain";
import { findUserByClerkId, insertUser } from "./repo";
import {
  applyClerkUserDelete,
  applyClerkUserUpsert,
  ensureUserByClerkId,
  getCurrentUserByClerkId,
  getUserById,
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
  await testDb.$client.exec(`TRUNCATE TABLE users RESTART IDENTITY CASCADE;`);
});

const samplePayload = (id: string): ClerkUserPayload => ({
  id,
  email_addresses: [{ id: "e1", email_address: "u@example.com" }],
  primary_email_address_id: "e1",
  first_name: "First",
  last_name: "Last",
});

describe("users/usecase (integration)", () => {
  test("getCurrentUserByClerkId returns the seeded user", async () => {
    const clerkId = `c_${randomUUID()}`;
    await insertUser(db, { clerkId, email: "x@x.com", name: null });

    const found = await getCurrentUserByClerkId(db, clerkId);
    expect(found?.email).toBe("x@x.com");
  });

  test("getCurrentUserByClerkId returns null when missing", async () => {
    expect(await getCurrentUserByClerkId(db, "absent")).toBeNull();
  });

  test("getUserById returns by primary key", async () => {
    const clerkId = `c_${randomUUID()}`;
    const u = await insertUser(db, { clerkId, email: "y@y.com", name: null });
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
    const found = await findUserByClerkId(db, clerkId);
    expect(found?.email).toBe("new@example.com");
    expect(found?.name).toBe("New Last");
  });

  test("applyClerkUserDelete removes the user", async () => {
    const clerkId = `c_${randomUUID()}`;
    await applyClerkUserUpsert(db, samplePayload(clerkId));
    await applyClerkUserDelete(db, clerkId);
    expect(await findUserByClerkId(db, clerkId)).toBeNull();
  });

  test("ensureUserByClerkId returns existing user without calling Clerk", async () => {
    const clerkId = `c_${randomUUID()}`;
    await insertUser(db, { clerkId, email: "exist@x.com", name: "Exist" });
    let fetchCalled = 0;
    const result = await ensureUserByClerkId(db, clerkId, {
      fetchClerkUser: async () => {
        fetchCalled++;
        return samplePayload(clerkId);
      },
    });
    expect(fetchCalled).toBe(0);
    expect(result.email).toBe("exist@x.com");
  });

  test("ensureUserByClerkId lazy-fetches from Clerk and upserts when missing", async () => {
    const clerkId = `c_${randomUUID()}`;
    let fetchCalled = 0;
    const result = await ensureUserByClerkId(db, clerkId, {
      fetchClerkUser: async (id) => {
        fetchCalled++;
        return samplePayload(id);
      },
    });
    expect(fetchCalled).toBe(1);
    expect(result.email).toBe("u@example.com");
    expect(result.name).toBe("First Last");
    const found = await findUserByClerkId(db, clerkId);
    expect(found?.id).toBe(result.id);
  });

  test("ensureUserByClerkId surfaces fetcher errors", async () => {
    await expect(
      ensureUserByClerkId(db, `c_${randomUUID()}`, {
        fetchClerkUser: async () => {
          throw new Error("clerk down");
        },
      }),
    ).rejects.toThrow(/clerk down/);
  });
});
