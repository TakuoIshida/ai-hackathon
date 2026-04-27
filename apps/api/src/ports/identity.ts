import type { Context, MiddlewareHandler } from "hono";

export type IdentityClaims = {
  externalId: string; // Clerk: userId (sub) / Auth0: sub
  email: string;
  emailVerified: boolean;
};

export type IdentityProfile = {
  externalId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type IdentityProviderPort = {
  /** ベンダー固有の認証 middleware を hono app に attach する */
  middleware: () => MiddlewareHandler;
  /** middleware 通過後の context から claims を取り出す。未認証は null */
  getClaims: (c: Context) => IdentityClaims | null;
  /** externalId からプロフィールを取得する。存在しない場合は null */
  getUserByExternalId: (externalId: string) => Promise<IdentityProfile | null>;
};
