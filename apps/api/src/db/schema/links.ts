// NOTE: links-related tables have been moved to the tenant schema (ISH-169 / D-2).
// This file re-exports from tenant.ts for backward compatibility during migration.
// Direct imports from "@/db/schema/links" still work, but prefer "@/db/schema/tenant".
export {
  type AvailabilityExclude,
  type AvailabilityLink,
  type AvailabilityRule,
  availabilityExcludes,
  availabilityLinks,
  availabilityRules,
  type LinkOwner,
  linkOwners,
  type NewAvailabilityExclude,
  type NewAvailabilityLink,
  type NewAvailabilityRule,
  type NewLinkOwner,
} from "./tenant";
