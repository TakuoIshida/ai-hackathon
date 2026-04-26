import { describe, expect, test } from "bun:test";
import {
  buildDisplayName,
  type ClerkUserPayload,
  deriveUserAttributes,
  pickPrimaryEmail,
} from "./domain";

const payload = (overrides: Partial<ClerkUserPayload> = {}): ClerkUserPayload => ({
  id: "user_123",
  email_addresses: [],
  primary_email_address_id: null,
  first_name: null,
  last_name: null,
  ...overrides,
});

describe("pickPrimaryEmail", () => {
  test("returns the primary email when matched", () => {
    expect(
      pickPrimaryEmail(
        payload({
          primary_email_address_id: "email_2",
          email_addresses: [
            { id: "email_1", email_address: "alt@example.com" },
            { id: "email_2", email_address: "primary@example.com" },
          ],
        }),
      ),
    ).toBe("primary@example.com");
  });

  test("falls back to the first email when primary id missing", () => {
    expect(
      pickPrimaryEmail(
        payload({
          email_addresses: [{ id: "x", email_address: "first@example.com" }],
        }),
      ),
    ).toBe("first@example.com");
  });

  test("returns null when no addresses", () => {
    expect(pickPrimaryEmail(payload())).toBeNull();
  });
});

describe("buildDisplayName", () => {
  test("joins first + last with space", () => {
    expect(buildDisplayName(payload({ first_name: "Taro", last_name: "Yamada" }))).toBe(
      "Taro Yamada",
    );
  });
  test("uses only first when last is empty", () => {
    expect(buildDisplayName(payload({ first_name: "Taro" }))).toBe("Taro");
  });
  test("returns null when both are empty", () => {
    expect(buildDisplayName(payload({ first_name: "", last_name: " " }))).toBeNull();
  });
  test("returns null when both are missing", () => {
    expect(buildDisplayName(payload())).toBeNull();
  });
});

describe("deriveUserAttributes", () => {
  test("derives email and name from a complete payload", () => {
    const attrs = deriveUserAttributes(
      payload({
        primary_email_address_id: "e1",
        email_addresses: [{ id: "e1", email_address: "a@b.com" }],
        first_name: "Hana",
        last_name: "Ko",
      }),
    );
    expect(attrs).toEqual({ clerkId: "user_123", email: "a@b.com", name: "Hana Ko" });
  });

  test("throws when no email is available", () => {
    expect(() => deriveUserAttributes(payload())).toThrow(/no email addresses/);
  });
});
