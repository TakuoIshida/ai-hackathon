import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/auth";
import { api } from "@/lib/api";
import type { MembershipRole } from "@/lib/types";
import { queryKeys } from "./queryKeys";

/**
 * TanStack Query hook for the tenant-scoped member listing returned by
 * `GET /tenant/members` (ISH-250). The endpoint is RLS-scoped to the
 * caller's active tenant, so the queryKey doesn't need a tenantId — the
 * cache is naturally per-session.
 *
 * Use this on the チーム設定 / メンバー tab. Mutations that affect the
 * listing (invite issued, member removed, role changed, invitation revoked)
 * should invalidate `queryKeys.tenant.all()` — the helper hooks below do
 * that automatically.
 */
export function useTenantMembersQuery() {
  const { getToken } = auth.useAuth();
  return useQuery({
    queryKey: queryKeys.tenant.members(),
    queryFn: () => api.listTenantMembers(() => getToken()),
  });
}

/**
 * Mutation hook for `DELETE /tenant/members/:userId` (ISH-251). Invalidates
 * the members query on success so the row disappears.
 */
export function useRemoveTenantMemberMutation() {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeTenantMember(userId, () => getToken()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tenant.all() });
    },
  });
}

/**
 * ISH-256: change a tenant member's role (owner ↔ member). Owner-only on the
 * server. Calls `PATCH /tenant/members/:userId`.
 */
export function useChangeTenantMemberRoleMutation() {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MembershipRole }) =>
      api.changeTenantMemberRole(userId, role, () => getToken()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tenant.all() });
    },
  });
}

/**
 * ISH-256: revoke a still-open tenant invitation. Owner-only.
 * Calls `DELETE /tenant/invitations/:invitationId`.
 *
 * Pending/expired rows from `GET /tenant/members` carry an `id` of the
 * form `inv:<invitationId>`. Settings strips the prefix before passing
 * the bare id here.
 */
export function useRevokeTenantInvitationMutation() {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      api.revokeTenantInvitation(invitationId, () => getToken()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tenant.all() });
    },
  });
}

/**
 * ISH-261: resend a still-open tenant invitation. Owner-only. Bumps the
 * server-side `expiresAt` by 24h and re-delivers the invitation email.
 * Calls `POST /tenant/invitations/:invitationId/resend`.
 *
 * Like the revoke mutation, the FE strips the `inv:` prefix from the
 * listing row id before passing the bare invitationId here.
 */
export function useResendTenantInvitationMutation() {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      api.resendTenantInvitation(invitationId, () => getToken()),
    onSuccess: () => {
      // Refresh the listing so the bumped `expiresAt` (and the "残り N 時間"
      // expiresIn label derived from it) updates immediately.
      qc.invalidateQueries({ queryKey: queryKeys.tenant.all() });
    },
  });
}
