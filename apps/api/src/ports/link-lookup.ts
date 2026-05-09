import type { Link, LinkWithRelations } from "@/links/domain";

export type { Link, LinkWithRelations };

/**
 * Read-side port for cross-feature link lookups. Bookings usecases need to
 * load a link's owner / co-owner set / metadata; instead of importing
 * `@/links/repo` directly, they go through this port.
 *
 * The production adapter (in `wiring.ts`) closes over the DB and delegates
 * to the actual repo functions.
 */
export type LinkLookupPort = {
  /** Plain row by id, no rules. Returns null when not found. */
  findLinkById(linkId: string): Promise<Link | null>;
  /**
   * Co-owner user IDs for a link. Primary owner (`link.userId`) is implicit
   * and is NOT returned here — callers prepend it themselves.
   */
  listLinkCoOwnerUserIds(linkId: string): Promise<ReadonlyArray<string>>;
};
