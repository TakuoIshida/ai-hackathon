import type { db as DbClient } from "@/db/client";
import { getValidAccessToken } from "@/google/access-token";
import { createEvent, deleteEvent, queryFreeBusy } from "@/google/calendar";
import type { GoogleConfig } from "@/google/config";
import { getOauthAccountByUser, listUserCalendars } from "@/google/repo";
import { buildClerkIdentityProvider } from "@/identity/clerk-identity-provider";
import { findLinkById, listLinkCoOwnerUserIds } from "@/links/repo";
import { computePublicSlots } from "@/links/usecase";
import type {
  GooglePort,
  IdentityProviderPort,
  LinkAvailabilityPort,
  LinkLookupPort,
  UserLookupPort,
} from "@/ports";
import { findUserById } from "@/users/repo";

type Database = typeof DbClient;

/**
 * Composition root for the cross-feature ports. Each builder closes over the
 * DB (and Google config where relevant) and returns a port that feature
 * usecases consume — this is the only place that knows how to assemble the
 * production adapters from raw repo / SDK calls.
 *
 * Tests bypass this module entirely and pass fake ports directly to usecases.
 */

/**
 * Build a production `GooglePort`. Returns `null` when Google env vars aren't
 * loaded (cfg is null) — feature usecases interpret null as "Google disabled"
 * and skip calendar sync / busy merge. Callers should NOT special-case
 * "disabled" before calling this; just pass `cfg` and forward the result.
 */
export function buildGooglePort(database: Database, cfg: GoogleConfig | null): GooglePort | null {
  if (!cfg) return null;
  return {
    getOauthAccountByUser: async (userId) => {
      const account = await getOauthAccountByUser(database, userId);
      return account ? { id: account.id } : null;
    },
    listUserCalendars: async (oauthAccountId) => {
      const calendars = await listUserCalendars(database, oauthAccountId);
      return calendars.map((c) => ({
        googleCalendarId: c.googleCalendarId,
        usedForBusy: c.usedForBusy,
        usedForWrites: c.usedForWrites,
      }));
    },
    getValidAccessToken: (oauthAccountId) => getValidAccessToken(database, cfg, oauthAccountId),
    getFreeBusy: (input) => queryFreeBusy(input),
    createEvent: (input) => createEvent(input),
    deleteEvent: (input) => deleteEvent(input),
  };
}

export function buildLinkLookupPort(database: Database): LinkLookupPort {
  return {
    findLinkById: (linkId) => findLinkById(database, linkId),
    listLinkCoOwnerUserIds: (linkId) => listLinkCoOwnerUserIds(database, linkId),
  };
}

/**
 * Build a `LinkAvailabilityPort` that delegates to `computePublicSlots`.
 * The Google port is forwarded through so confirmBooking's revalidation
 * step picks up the same busy data as the public slots endpoint.
 */
export function buildLinkAvailabilityPort(
  database: Database,
  google: GooglePort | null,
): LinkAvailabilityPort {
  return {
    computePublicSlots: (link, params) =>
      computePublicSlots(database, link, params, google ?? undefined),
  };
}

export function buildUserLookupPort(database: Database): UserLookupPort {
  return {
    findUserById: async (userId) => {
      const user = await findUserById(database, userId);
      return user ? { id: user.id, email: user.email, name: user.name } : null;
    },
  };
}

/**
 * Build the production IdentityProviderPort backed by Clerk.
 * Swap this function's return value to switch identity providers without
 * touching any other app code.
 */
export function buildIdentityProvider(): IdentityProviderPort {
  return buildClerkIdentityProvider();
}
