import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/auth";
import { api } from "@/lib/api";
import type { LinkInput } from "@/lib/types";
import { queryKeys } from "./queryKeys";

/**
 * TanStack Query hooks for the `links` resource.
 *
 * Each hook reads `getToken` from `auth.useAuth()` internally so call sites
 * don't have to pass it. Mutations invalidate the relevant list / detail
 * caches on success.
 */

export function useLinksQuery() {
  const { getToken } = auth.useAuth();
  return useQuery({
    queryKey: queryKeys.links.list(),
    queryFn: () => api.listLinks(() => getToken()),
  });
}

export function useLinkQuery(id: string | undefined) {
  const { getToken } = auth.useAuth();
  return useQuery({
    queryKey: queryKeys.links.detail(id ?? ""),
    queryFn: () => {
      if (!id) throw new Error("link id is required");
      return api.getLink(id, () => getToken());
    },
    enabled: id != null,
  });
}

export function useCreateLinkMutation() {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkInput) => api.createLink(input, () => getToken()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.links.all() });
    },
  });
}

export function useUpdateLinkMutation(id: string) {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<LinkInput>) => api.updateLink(id, input, () => getToken()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.links.all() });
    },
  });
}

export function useDeleteLinkMutation() {
  const { getToken } = auth.useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteLink(id, () => getToken()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.links.all() });
    },
  });
}
