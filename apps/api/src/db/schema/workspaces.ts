// NOTE: The invitations table has been moved to tenant.invitations (ISH-169 / D-2).
// This file re-exports from tenant.ts for backward compatibility during migration.
// Direct imports from "@/db/schema/workspaces" still work, but prefer "@/db/schema/tenant".
//
// IMPORTANT: invitations.workspaceId has been renamed to invitations.tenantId.
// Callers that reference `invitation.workspaceId` must be updated to use `invitation.tenantId`.
export { type Invitation, invitations, type NewInvitation } from "./tenant";
