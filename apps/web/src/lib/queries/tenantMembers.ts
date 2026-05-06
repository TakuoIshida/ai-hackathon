import { useQuery } from "@tanstack/react-query";
import { auth } from "@/auth";
import { api } from "@/lib/api";
import { queryKeys } from "./queryKeys";

/**
 * TanStack Query hook for the tenant-scoped member listing returned by
 * `GET /tenant/members` (ISH-250). The endpoint is RLS-scoped to the
 * caller's active tenant, so the queryKey doesn't need a tenantId — the
 * cache is naturally per-session.
 *
 * Use this on the チーム設定 / メンバー tab. Mutations that affect the
 * listing (invite issued, member removed, role changed) should invalidate
 * `queryKeys.tenant.members()`.
 */
export function useTenantMembersQuery() {
  const { getToken } = auth.useAuth();
  return useQuery({
    queryKey: queryKeys.tenant.members(),
    queryFn: () => api.listTenantMembers(() => getToken()),
  });
}
