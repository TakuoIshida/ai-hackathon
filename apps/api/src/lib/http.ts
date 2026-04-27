export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const httpFetch: FetchLike = (input, init) => globalThis.fetch(input, init);
