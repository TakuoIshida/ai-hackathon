/**
 * Centralized queryKey factory.
 *
 * Use these instead of inline arrays so that invalidation patterns stay in
 * sync with the query definitions. Each key is a tuple — the first element
 * is the resource name, the rest narrow the scope.
 */
export const queryKeys = {
  links: {
    all: () => ["links"] as const,
    list: () => ["links", "list"] as const,
    detail: (id: string) => ["links", "detail", id] as const,
    slugAvailable: (slug: string) => ["links", "slug-available", slug] as const,
  },
  bookings: {
    all: () => ["bookings"] as const,
    list: () => ["bookings", "list"] as const,
  },
  google: {
    all: () => ["google"] as const,
    connection: () => ["google", "connection"] as const,
  },
  workspaces: {
    all: () => ["workspaces"] as const,
    list: () => ["workspaces", "list"] as const,
    detail: (id: string) => ["workspaces", "detail", id] as const,
    members: (id: string) => ["workspaces", "members", id] as const,
  },
  invitations: {
    detail: (token: string) => ["invitations", "detail", token] as const,
  },
} as const;
