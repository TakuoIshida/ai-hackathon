import type { AuthAdapter } from "./AuthAdapter";
import { clerkAuthAdapter } from "./clerk-auth-adapter";

export const auth: AuthAdapter = clerkAuthAdapter;
export type { AuthAdapter, UseAuthResult } from "./AuthAdapter";
