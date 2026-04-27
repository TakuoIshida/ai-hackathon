import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { clearDbForTests, db, setDbForTests } from "@/db/client";
import { createTestDb, type TestDb } from "@/test/integration-db";
import {
  deleteUserByExternalId,
  findUserByExternalId,
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
  await testDb.$client.exec(`TRUNCATE TABLE common.users RESTART IDENTITY CASCADE;`);
});

describe("users/repo", () => {
  test("insertUser creates a row and findUserByExternalId returns it", async () => {
    const externalId = `clerk_${randomUUID()}`;
    const created = await insertUser(db, { externalId, email: "a@b.com", name: "Alice" });
    expect(created.email).toBe("a@b.com");

    const found = await findUserByExternalId(db, externalId);
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe("Alice");
  });

  test("findUserByExternalId returns null when missing", async () => {
    expect(await findUserByExternalId(db, "absent")).toBeNull();
  });

  test("findUserById returns the row by id", async () => {
    const inserted = await insertUser(db, {
      externalId: `c_${randomUUID()}`,
      email: "x@y.com",
      name: null,
    });
    const found = await findUserById(db, inserted.id);
    expect(found?.id).toBe(inserted.id);
  });

  test("insertUser is idempotent on externalId conflict (updates email/name)", async () => {
    const externalId = `c_${randomUUID()}`;
    await insertUser(db, { externalId, email: "old@x.com", name: "Old" });
    const updated = await insertUser(db, { externalId, email: "new@x.com", name: "New" });
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

  test("deleteUserByExternalId removes the row", async () => {
    const externalId = `c_${randomUUID()}`;
    await insertUser(db, { externalId, email: "z@z.com", name: null });
    await deleteUserByExternalId(db, externalId);
    expect(await findUserByExternalId(db, externalId)).toBeNull();
  });
});
