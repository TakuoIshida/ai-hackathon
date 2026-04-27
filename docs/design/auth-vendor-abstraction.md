# 認証ベンダー抽象化設計書 (ISH-165)

## 概要

現在 Clerk で実装されている認証機能を、将来 Auth0 等の別ベンダーに切り替えられるよう
BE / FE の両レイヤーに薄い wrapper を設ける。アプリコードは wrapper 経由でのみ認証機能を使い、
Clerk SDK を直接 import しない。

関連 issue: ISH-165 (設計) / D-5a (BE port 定義) / D-5b (Clerk 実装) / F-1a (FE adapter 実装)

---

## 設計原則

1. **ベンダー差し替えゼロコスト** — vendor 実装ファイル (`clerk-identity-provider.ts`, `clerk-auth-adapter.tsx`) を
   差し替えるだけでアプリコードに修正が入らない。
2. **wrapper は薄く** — ベンダー固有の概念 (Clerk Organizations, User Metadata, Session Claims の拡張など)
   は wrapper の外に漏らさない。
3. **Clerk Organizations は使わない** — tenant 管理は自前テーブル `common.tenants` / `common.tenant_members`
   で行う。移植性低下につながる Clerk 組織機能には依存しない。
4. **身元証明に徹する** — 認証ベンダーには `externalId` / `email` / `emailVerified` の 3 つだけを委ねる。
   テナント所属・ロール等は自前 DB で管理。

---

## BE: IdentityProviderPort 設計

### 配置

```
apps/api/src/ports/identity.ts              ← port interface (D-5a)
apps/api/src/identity/clerk-identity-provider.ts  ← Clerk 実装 (D-5b)
```

### interface 定義

```ts
// apps/api/src/ports/identity.ts
import type { Context, MiddlewareHandler } from "hono"

export type IdentityClaims = {
  externalId: string      // Clerk: userId (sub) / Auth0: sub
  email: string
  emailVerified: boolean
}

export type IdentityProfile = {
  externalId: string
  email: string
  firstName: string | null
  lastName: string | null
}

export type IdentityProviderPort = {
  /** ベンダー固有の認証 middleware を hono app に attach する */
  middleware: () => MiddlewareHandler
  /** middleware 通過後の context から claims を取り出す。未認証は null */
  getClaims: (c: Context) => IdentityClaims | null
  /** externalId からプロフィールを取得する。存在しない場合は null */
  getUserByExternalId: (externalId: string) => Promise<IdentityProfile | null>
}
```

> `verifySession(req: Request)` のように生 Request を取る形だと、Clerk の `clerkMiddleware` が hono context に書き込んだ auth 情報にアクセスできない。
> ベンダー側 middleware を `idp.middleware()` で取り出して attach し、handler 内で `idp.getClaims(c)` を呼ぶ 2 段構成にすることで、Clerk / Auth0 双方の典型的な API パターンを抽象化できる。

### 既存 ClerkPort との関係

現状の構成 (実装フェーズで詳細確認):
- `apps/api/src/users/usecase.ts` 周辺に `ClerkPort` interface (型定義)
- `apps/api/src/users/clerk-port.ts` に Clerk 実装 (production adapter, CLAUDE.md にも例示)

`ClerkPort` は「DB ユーザー upsert 用のプロフィール取得」という目的に特化している。

**推奨: 委譲 (delegation) で共存させる**

- `IdentityProviderPort.getUserByExternalId` は `IdentityProfile` (wrapper 抽象型) を返す。
- Clerk 実装 (`identity/clerk-identity-provider.ts`) の内部でのみ `@clerk/backend` を呼び出す。
- 既存 `users/clerk-port.ts` のロジックを `clerk-identity-provider.ts` 内に吸収し、
  `users/usecase.ts` は `IdentityProfile` を受け取る形にリファクタリングする (D-5b 担当)。
- 移行完了後は `users/clerk-port.ts` および usecase.ts 側の `ClerkPort` 型を削除してよい。

### middleware/auth.ts の書き換え方針

現在 `apps/api/src/middleware/auth.ts` は `@hono/clerk-auth` の `clerkMiddleware` / `getAuth()` を
直接使用している。D-5b では以下の方向に書き換える。

```ts
// 書き換え後イメージ (D-5b 担当)
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import type { IdentityProviderPort } from "@/ports/identity"

export function attachAuth(app: Hono, idp: IdentityProviderPort) {
  // 1. ベンダー middleware を先に attach (例: Clerk の clerkMiddleware が context に auth をセット)
  app.use("*", idp.middleware())
  // 2. claims guard: 認証必須ルートで未認証は 401
  app.use("*", async (c, next) => {
    const claims = idp.getClaims(c)
    if (!claims) throw new HTTPException(401, { message: "unauthorized" })
    c.set("identityClaims", claims)
    await next()
  })
}
```

- `clerkAuth` / `requireAuth` / `getClerkUserId` をまとめて `attachAuth` に集約する。
- `wiring.ts` の composition root で `IdentityProviderPort` を組み立てて渡す。
- テストは fake `IdentityProviderPort` を差し込むだけで認証をバイパスできる (`middleware()` は no-op、`getClaims()` は固定 claims を返す)。

### JWT 検証戦略

| ベンダー | 検証方法 |
|---------|---------|
| Clerk | `@hono/clerk-auth` の networkless verify (公開鍵をキャッシュ) |
| Auth0 (切替時) | JWKS endpoint から公開鍵取得 → ローカルキャッシュ (`jose` ライブラリ相当) |

切替時に変わるのは Clerk 実装ファイル 1 つのみ。アプリコードの JWT 検証ロジックには手が入らない。

---

## FE: AuthAdapter 設計

### 配置

```
apps/web/src/auth/AuthAdapter.tsx           ← interface 定義 (F-1a)
apps/web/src/auth/clerk-auth-adapter.tsx    ← Clerk 実装 (F-1a)
apps/web/src/auth/index.ts                  ← export const auth = clerkAuthAdapter (F-1a)
```

### interface 定義

```tsx
// apps/web/src/auth/AuthAdapter.tsx

export type UseAuthResult = {
  isSignedIn: boolean
  /** ベンダー独立の身元 ID (Clerk: clerk_id / Auth0: sub)。アプリ DB の `users.id` (ULID) とは別物 */
  externalId: string | null
  getToken: () => Promise<string | null>
}

export type AuthAdapter = {
  Provider: React.FC<{ children: React.ReactNode }>
  useAuth: () => UseAuthResult
  SignInPage: React.FC
  SignUpPage: React.FC
  SignOutButton: React.FC<{ children?: React.ReactNode }>
  SignedIn: React.FC<{ children: React.ReactNode }>
  SignedOut: React.FC<{ children: React.ReactNode }>
}
```

### エントリポイント

```ts
// apps/web/src/auth/index.ts
import { clerkAuthAdapter } from "./clerk-auth-adapter"
import type { AuthAdapter } from "./AuthAdapter"

export const auth: AuthAdapter = clerkAuthAdapter
export type { AuthAdapter, UseAuthResult } from "./AuthAdapter"
```

### アプリコードの使用パターン

```tsx
// アプリコードはこれだけ
import { auth } from "~/auth"

// Provider
<auth.Provider>...</auth.Provider>

// コンポーネント
<auth.SignedIn><Dashboard /></auth.SignedIn>
<auth.SignedOut><auth.SignInPage /></auth.SignedOut>

// hook
const { isSignedIn, getToken } = auth.useAuth()
```

### 既存ファイルの書き換え方針 (F-1a 担当)

| ファイル | 現在の import | 書き換え後 |
|---------|-------------|----------|
| `apps/web/src/main.tsx` | `ClerkProvider` from `@clerk/clerk-react` | `auth.Provider` from `~/auth` |
| `apps/web/src/App.tsx` | `SignedIn`, `SignedOut`, `RedirectToSignIn` from `@clerk/clerk-react` | `auth.SignedIn`, `auth.SignedOut` from `~/auth` |
| `apps/web/src/routes/SignIn.tsx` | Clerk sign-in component | `auth.SignInPage` from `~/auth` |
| `apps/web/src/routes/SignUp.tsx` | Clerk sign-up component | `auth.SignUpPage` from `~/auth` |

`VITE_CLERK_PUBLISHABLE_KEY` 未設定時の分岐 (`main.tsx:40-45`) は
`auth.Provider` の内部実装に封じ込め、アプリコードからは見えなくする。

---

## SDK 直接 import 禁止ルール

### 推奨方式: CI での `rg` チェック

```bash
# CI スクリプト例 (D-5b / F-1a 完了後に追加)
# BE: @clerk/ を identity/ 以外の apps/api/src で検出したら fail
rg "@clerk/" apps/api/src --glob "!apps/api/src/identity/**" -l && exit 1 || true

# FE: @clerk/ を auth/ 以外の apps/web/src で検出したら fail
rg "@clerk/" apps/web/src --glob "!apps/web/src/auth/**" -l && exit 1 || true
```

### Biome `noRestrictedImports` の制約

Biome v1.x の `noRestrictedImports` はパスパターン (glob) ではなく完全一致文字列しか受け付けない。
`@clerk/clerk-react` / `@clerk/backend` を個別に列挙すれば技術的には実現可能だが、
パッケージが増えるたびにルールを追加しなければならない。

**結論: `rg` による CI チェックを採用する**

- glob 除外が直感的に書けるため管理コストが低い。
- Biome ルールは補助的に `@clerk/clerk-react` と `@clerk/backend` を `noRestrictedImports` に列挙し、
  ローカル開発時の早期検出に使う (CI は rg チェックが最終防衛ライン)。

---

## Clerk から Auth0 への切替シナリオ

### 切替時に変わるもの

| 対象 | 変更内容 |
|-----|---------|
| `apps/api/src/identity/clerk-identity-provider.ts` | `auth0-identity-provider.ts` を新規実装し差し替え |
| `apps/web/src/auth/clerk-auth-adapter.tsx` | `auth0-auth-adapter.tsx` を新規実装し差し替え |
| `apps/web/src/auth/index.ts` | `export const auth = auth0AuthAdapter` に変更 |
| `apps/api/src/wiring.ts` | `buildIdentityProviderPort()` が返す実装を差し替え |
| 環境変数 | `AUTH_PROVIDER=clerk` → `AUTH_PROVIDER=auth0` / 認証情報を更新 |

### 切替時に変わらないもの

- `apps/api/src/ports/identity.ts` (interface 定義)
- `apps/api/src/middleware/auth.ts` (書き換え後)
- route 定義・usecase・domain・repo の全ファイル
- `apps/web/src/auth/AuthAdapter.tsx` (interface 定義)
- アプリコード (`routes/`, `components/` 配下の全ファイル)

### JWT verify の差異

```
Clerk:  networkless verify (JWT の RS256 署名を公開鍵でローカル検証)
Auth0:  JWKS endpoint (https://<tenant>.auth0.com/.well-known/jwks.json) から
        公開鍵を取得し TTL キャッシュ → `jose` ライブラリで検証
```

Auth0 切替時は `clerk-identity-provider.ts` の `verifySession` 実装のみが変わる。
JWKS キャッシュは実装ファイル内に閉じるため、middleware / route には影響しない。

### 環境変数による boot 切替案

```
# .env
AUTH_PROVIDER=clerk   # or auth0

# apps/api/src/wiring.ts (切替後のイメージ)
import { buildClerkIdentityProvider } from "@/identity/clerk-identity-provider"
import { buildAuth0IdentityProvider } from "@/identity/auth0-identity-provider"

export function buildIdentityProviderPort(): IdentityProviderPort {
  return config.authProvider === "auth0"
    ? buildAuth0IdentityProvider()
    : buildClerkIdentityProvider()
}
```

現時点では `AUTH_PROVIDER=clerk` のみ実装。Auth0 は切替シナリオが確定した時点で実装する。

---

## Clerk 固有概念の wrapper 越境チェック

以下はすべて「ベンダーロックを引き起こすリスクがある概念」のチェックリスト。
wrapper を実装する際に **漏れていないことを確認**すること。

| Clerk 固有概念 | 状態 | 対応方針 |
|--------------|------|---------|
| Organizations 機能 | 使わない (確定) | IdentityProviderPort に含めない |
| User Metadata (public/private) | 使わない (確定) | `IdentityProfile` / `IdentityClaims` から除外 |
| Session JWT の追加 claim | 使わない | `externalId` / `email` / `emailVerified` の 3 つに限定 |
| Webhook (`clerk.users.created` 等) | 使わない (確定) | D-6 で API 経由の明示 onboarding を行う |
| Email Verification callback URL | 使わない (確定) | Clerk hosted page で完結する。アプリ側でのコード対応は不要 (Webhook も使わない方針と整合) |
| `useUser()` hook の `publicMetadata` | 使わない | `auth.useAuth()` は `UseAuthResult` の 3 フィールドのみ公開 |
| Clerk Components のスタイリング | wrapper 内に封じ込め | `auth.SignInPage` が返す JSX 内でのみ `@clerk/clerk-react` を import |

### リーク検出 checklist (D-5b / F-1a レビュー時)

- [ ] `IdentityClaims` / `IdentityProfile` に `clerk_*` / `org_*` / `metadata` フィールドがないか
- [ ] `UseAuthResult` に `sessionId` / `orgId` / `publicMetadata` が含まれていないか
- [ ] `apps/api/src/` 配下 (identity/ 除く) に `@clerk/` import がないか (`rg` で確認)
- [ ] `apps/web/src/` 配下 (auth/ 除く) に `@clerk/` import がないか (`rg` で確認)
- [ ] `AuthAdapter.Provider` の props に Clerk 固有の `publishableKey` などが漏れていないか

---

## D-5a / D-5b / F-1a 担当への引き継ぎ

### D-5a: BE port interface 定義 + wiring.ts skeleton

- [ ] `apps/api/src/ports/identity.ts` を新規作成し `IdentityClaims` / `IdentityProfile` / `IdentityProviderPort` を定義
- [ ] `apps/api/src/ports/index.ts` に `IdentityProviderPort` を追加 export
- [ ] `apps/api/src/wiring.ts` に `buildIdentityProvider()` 関数の skeleton を追加 (実装注入は D-5b)
  - シグネチャ: `() => IdentityProviderPort`
  - 中身は `throw new Error("not implemented")` か、stub 実装で OK
- [ ] 既存 `ClerkPort` (users/clerk-port.ts と usecase.ts) と interface の役割分担を確認し、統合方針をコメントで残す

### D-5b: Clerk BE 実装 + middleware 書き換え

- [ ] `apps/api/src/identity/clerk-identity-provider.ts` を新規作成
  - `verifySession`: `@hono/clerk-auth` の `getAuth()` / `clerkMiddleware` を内部利用
  - `getUserByExternalId`: `@clerk/backend` の `clerk.users.getUser()` を内部利用
- [ ] `apps/api/src/middleware/auth.ts` を `IdentityProviderPort` 経由に書き換え
- [ ] `apps/api/src/wiring.ts` に `buildIdentityProviderPort()` を追加
- [ ] 既存 `users/clerk-port.ts` の `ClerkPort` を `clerk-identity-provider.ts` に吸収し、
  `users/usecase.ts` が `IdentityProfile` を受け取る形にリファクタリング
- [ ] 越境チェックリストを通過することを確認

### F-1a: FE AuthAdapter 実装 + main.tsx / App.tsx 書き換え

- [ ] `apps/web/src/auth/AuthAdapter.tsx` を新規作成 (interface 定義)
- [ ] `apps/web/src/auth/clerk-auth-adapter.tsx` を新規作成 (Clerk 実装)
- [ ] `apps/web/src/auth/index.ts` を新規作成 (`export const auth = clerkAuthAdapter`)
- [ ] `apps/web/src/main.tsx` の `ClerkProvider` を `auth.Provider` に置換
  - `VITE_CLERK_PUBLISHABLE_KEY` 未設定時の分岐を `auth.Provider` 内部に封じ込め
- [ ] `apps/web/src/App.tsx` の `SignedIn` / `SignedOut` / `RedirectToSignIn` を `auth.*` に置換
- [ ] `apps/web/src/routes/SignIn.tsx` / `SignUp.tsx` を `auth.SignInPage` / `auth.SignUpPage` に置換
- [ ] 越境チェックリストを通過することを確認
- [ ] CI に `rg @clerk/ apps/web/src --glob '!apps/web/src/auth/**'` チェックを追加
