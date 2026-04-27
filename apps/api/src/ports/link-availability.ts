import type { LinkWithRelations } from "@/links/domain";
import type { AvailabilityWindow, Interval, Slot } from "@/scheduling";

export type PublicSlotsParams = {
  fromMs: number;
  toMs: number;
  nowMs?: number;
};

export type PublicSlotsResult = {
  windows: AvailabilityWindow[];
  busy: Interval[];
  slots: Slot[];
  effectiveRange: Interval | null;
};

/**
 * Port that wraps `links/usecase.computePublicSlots` for cross-feature use.
 * Bookings calls this for the slot-revalidation step in `confirmBooking`.
 *
 * The production adapter (in `wiring.ts`) closes over the DB + GooglePort and
 * delegates to the actual `computePublicSlots` usecase.
 */
export type LinkAvailabilityPort = {
  computePublicSlots(
    link: LinkWithRelations,
    params: PublicSlotsParams,
  ): Promise<PublicSlotsResult>;
};
