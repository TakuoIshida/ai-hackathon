import type React from "react";

export type UseAuthResult = {
  isSignedIn: boolean;
  /** ベンダー独立の身元 ID (Clerk: clerk_id / Auth0: sub)。アプリ DB の users.id (ULID) とは別物 */
  externalId: string | null;
  getToken: () => Promise<string | null>;
};

export type AuthAdapter = {
  Provider: React.FC<{ children: React.ReactNode }>;
  useAuth: () => UseAuthResult;
  SignInPage: React.FC;
  SignUpPage: React.FC;
  SignOutButton: React.FC<{ children?: React.ReactNode }>;
  SignedIn: React.FC<{ children: React.ReactNode }>;
  SignedOut: React.FC<{ children: React.ReactNode }>;
  /** ユーザーアバター + サインアウトメニュー (DashboardLayout 用) */
  UserButton: React.FC;
  /**
   * インラインサインインボタン。mode="modal" でモーダルを開く。
   * AcceptInvite など、アプリ内の一部フローで使用する。
   */
  SignInButton: React.FC<{
    children?: React.ReactNode;
    mode?: "modal" | "redirect";
    forceRedirectUrl?: string;
    signUpForceRedirectUrl?: string;
  }>;
  /** インラインサインアップボタン。 */
  SignUpButton: React.FC<{
    children?: React.ReactNode;
    mode?: "modal" | "redirect";
    forceRedirectUrl?: string;
    signInForceRedirectUrl?: string;
  }>;
};
