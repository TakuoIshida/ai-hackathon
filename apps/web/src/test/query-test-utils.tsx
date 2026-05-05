import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

/**
 * Wraps `children` with a fresh `QueryClient` configured for tests:
 *
 * - `retry: false` — avoid spurious re-runs on simulated failures
 * - `gcTime: 0` — discard cache between tests (one client per test run)
 *
 * Use it via `render(<TestQueryProvider>...</TestQueryProvider>)` or call
 * `withQueryClient(node)` to get the wrapped element.
 */
export function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function TestQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => makeTestQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function withQueryClient(node: React.ReactNode): React.ReactElement {
  return <TestQueryProvider>{node}</TestQueryProvider>;
}
