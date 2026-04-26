import type { users } from "@/db/schema/users";

export type UserEntity = typeof users.$inferSelect;
export type NewUserAttributes = typeof users.$inferInsert;

export type ClerkUserPayload = {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export function pickPrimaryEmail(payload: ClerkUserPayload): string | null {
  const primary = payload.email_addresses.find((e) => e.id === payload.primary_email_address_id);
  if (primary) return primary.email_address;
  return payload.email_addresses[0]?.email_address ?? null;
}

export function buildDisplayName(payload: ClerkUserPayload): string | null {
  const first = payload.first_name?.trim() ?? "";
  const last = payload.last_name?.trim() ?? "";
  const combined = [first, last].filter(Boolean).join(" ");
  return combined.length > 0 ? combined : null;
}

export function deriveUserAttributes(payload: ClerkUserPayload): {
  clerkId: string;
  email: string;
  name: string | null;
} {
  const email = pickPrimaryEmail(payload);
  if (!email) {
    throw new Error(`Clerk user ${payload.id} has no email addresses`);
  }
  return { clerkId: payload.id, email, name: buildDisplayName(payload) };
}
