import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { createTestDb, type TestDb } from "@/test/integration-db";
import {
  deleteUserByClerkId,
  findUserByClerkId,
  findUserById,
  insertUser,
  upsertUserFromPayload,
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
  await testDb.$client.exec(`TRUNCATE TABLE users RESTART IDENTITY CASCADE;`);
});

describe("users/repo", () => {
  test("insertUser creates a row and findUserByClerkId returns it", async () => {
    const clerkId = `clerk_${randomUUID()}`;
    const created = await insertUser(db, { clerkId, email: "a@b.com", name: "Alice" });
    expect(created.email).toBe("a@b.com");

    const found = await findUserByClerkId(db, clerkId);
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe("Alice");
  });

  test("findUserByClerkId returns null when missing", async () => {
    expect(await findUserByClerkId(db, "absent")).toBeNull();
  });

  test("findUserById returns the row by id", async () => {
    const inserted = await insertUser(db, {
      clerkId: `c_${randomUUID()}`,
      email: "x@y.com",
      name: null,
    });
    const found = await findUserById(db, inserted.id);
    expect(found?.id).toBe(inserted.id);
  });

  test("insertUser is idempotent on clerkId conflict (updates email/name)", async () => {
    const clerkId = `c_${randomUUID()}`;
    await insertUser(db, { clerkId, email: "old@x.com", name: "Old" });
    const updated = await insertUser(db, { clerkId, email: "new@x.com", name: "New" });
    expect(updated.email).toBe("new@x.com");
    expect(updated.name).toBe("New");
  });

  test("upsertUserFromPayload derives attributes from Clerk payload", async () => {
    const clerkId = `c_${randomUUID()}`;
    const row = await upsertUserFromPayload(db, {
      id: clerkId,
      email_addresses: [{ id: "e1", email_address: "p@q.com" }],
      primary_email_address_id: "e1",
      first_name: "Sa",
      last_name: "Ku",
    });
    expect(row.email).toBe("p@q.com");
    expect(row.name).toBe("Sa Ku");
  });

  test("deleteUserByClerkId removes the row", async () => {
    const clerkId = `c_${randomUUID()}`;
    await insertUser(db, { clerkId, email: "z@z.com", name: null });
    await deleteUserByClerkId(db, clerkId);
    expect(await findUserByClerkId(db, clerkId)).toBeNull();
  });
});
