import { createClerkClient } from "@clerk/backend";
import type { ClerkUserPayload } from "./domain";
import type { ClerkPort } from "./usecase";

/**
 * Production adapter that wires a real `@clerk/backend` client behind the
 * `ClerkPort` interface. This is the boundary between the usecase layer
 * (which knows nothing about Clerk's SDK) and the Clerk service.
 *
 * Lives in its own file so route + middleware modules can both import it
 * without dragging the rest of the route/middleware layer along.
 */
export function productionClerkPort(): ClerkPort {
  return {
    fetchUser: async (clerkId): Promise<ClerkUserPayload> => {
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) {
        throw new Error("CLERK_SECRET_KEY is not set; cannot lazy-fetch user from Clerk");
      }
      const clerk = createClerkClient({ secretKey });
      const u = await clerk.users.getUser(clerkId);
      return {
        id: clerkId,
        email_addresses: u.emailAddresses.map((e) => ({
          id: e.id,
          email_address: e.emailAddress,
        })),
        primary_email_address_id: u.primaryEmailAddressId ?? null,
        first_name: u.firstName ?? null,
        last_name: u.lastName ?? null,
      };
    },
  };
}
