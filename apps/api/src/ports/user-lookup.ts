/**
 * Minimal user view exposed to feature usecases — only the fields needed for
 * notification rendering (email + display name) and ownership checks (id).
 * The full `users` row never escapes the adapter.
 */
export type UserView = {
  id: string;
  email: string;
  name: string | null;
};

/**
 * Read-side port for cross-feature user lookups. Bookings usecases need the
 * link owner's email/name to publish notification events; instead of
 * importing `@/users/usecase` directly, they go through this port.
 */
export type UserLookupPort = {
  findUserById(userId: string): Promise<UserView | null>;
};
