import { QueryClient } from "@tanstack/react-query";

/**
 * Single QueryClient instance for the app. Configured with sensible defaults:
 *
 * - `staleTime: 30s` — avoid refetch storms when navigating between routes
 * - `retry: 1` — one retry for transient failures, then bubble to UI
 * - `refetchOnWindowFocus: false` — explicit revalidation only
 *
 * Mutations don't retry by default (the user can re-submit).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
