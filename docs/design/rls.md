# RLS ポリシー設計書 (ISH-164)

本書はマルチテナント DB 移行における Row Level Security (RLS) の設計方針を定めたものです。
コード変更・migration 実装は別タスク (D-3 / D-4) で行います。

---

## 1. Role 設計

### 1-1. role の種別と責務

| role | 用途 | RLS | 備考 |
|------|------|-----|------|
| `admin` | migration 実行・スキーマ変更 | bypass | `BYPASSRLS` 権限付与 |
| `app` | アプリ runtime の通常クエリ | 適用 | `SET LOCAL` 経由で tenant_id 制御 |

- `admin` は接続文字列を `DATABASE_URL_ADMIN` として環境変数で分離する (後述 §5)
- `app` は `DATABASE_URL` に対応。アプリコードがこの role のみを使う

### 1-2. CREATE ROLE / GRANT / REVOKE 雛形

```sql
-- admin role (migration 用)
CREATE ROLE admin WITH LOGIN PASSWORD '...' BYPASSRLS CREATEROLE;

-- app role (runtime 用)
CREATE ROLE app WITH LOGIN PASSWORD '...';
```

```sql
-- common schema: app に SELECT のみ許可
GRANT USAGE ON SCHEMA common TO app;
GRANT SELECT ON ALL TABLES IN SCHEMA common TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA common
  GRANT SELECT ON TABLES TO app;

-- common schema の書き込みは原則 REVOKE
-- (INSERT/UPDATE は §6 で SECURITY DEFINER 関数または明示的 GRANT で管理)
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA common FROM app;
```

```sql
-- tenant schema: app に全操作を許可 (RLS で行レベル制御)
GRANT USAGE ON SCHEMA tenant TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA tenant
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
```

```sql
-- admin には全スキーマ R/W + RLS bypass
GRANT ALL ON SCHEMA common, tenant TO admin;
GRANT ALL ON ALL TABLES IN SCHEMA common TO admin;
GRANT ALL ON ALL TABLES IN SCHEMA tenant TO admin;
```

---

## 2. RLS ポリシー設計

### 2-1. ENABLE vs FORCE ROW LEVEL SECURITY

| 設定 | 対象 | 動作 |
|------|------|------|
| `ENABLE ROW LEVEL SECURITY` | テーブル所有者以外 | RLS を有効化。テーブル所有者は bypass |
| `FORCE ROW LEVEL SECURITY` | テーブル所有者含む全 role | 所有者も含め全 role に RLS を適用 |

- `admin` は `BYPASSRLS` 権限を持つため、`FORCE` を付けても bypass される
- `app` role がテーブル所有者になるケースを避けるため、テーブル所有者は `admin` に統一する
- 結論: **`ENABLE ROW LEVEL SECURITY` のみ付与**。`FORCE` は不要だが付けても害はない

### 2-2. USING と WITH CHECK の両方を使う理由

| 句 | 適用タイミング | 対象操作 |
|----|---------------|---------|
| `USING` | 行の可視性フィルタ | SELECT / UPDATE / DELETE の既存行 |
| `WITH CHECK` | 書き込みの検証 | INSERT / UPDATE の新規行 |

両方を定義しないと、`USING` だけでは INSERT で他テナントの `tenant_id` を指定した行を挿入できてしまう。
`WITH CHECK` を省略すると `USING` 式が暗黙の `WITH CHECK` として使われるが、明示的に書く方が意図が明確で安全。

### 2-3. 雛形 SQL

```sql
-- テーブルに RLS を有効化
ALTER TABLE tenant.<table> ENABLE ROW LEVEL SECURITY;

-- テナント分離ポリシー
CREATE POLICY tenant_isolation ON tenant.<table>
  USING (
    tenant_id = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
  );
```

### 2-4. `current_setting` の第二引数 `true` (missing_ok) の意味

```sql
current_setting('app.tenant_id', true)
-- 第二引数 true = "変数が未設定でもエラーを出さず NULL を返す"
-- 第二引数 false (デフォルト) = 未設定時に ERROR を raise
```

- `true` (missing_ok) を指定すると未設定時は `NULL` が返り、`tenant_id = NULL` は常に FALSE → **0 行返却**
- 誤ってセッション変数を設定し忘れた場合も silent にデータ漏洩せず、空結果で返る
- ただしアプリバグの発見が遅れるリスクもあるため、middleware でのアサーションを必須とする (§3 参照)

---

## 3. セッション変数 `app.tenant_id`

### 3-1. 設定する層

```
HTTP Request
  └─ auth middleware (auth.ts)
       └─ attachDbUser: Clerk user_id → DB user → tenant_id を解決
            └─ transaction 開始時に SET LOCAL を発行
```

設定箇所は **transaction の中**に限定する。`SET LOCAL` は現在のトランザクション内のみ有効で、コミット/ロールバック時に自動的に解放される。

```sql
-- transaction 内での設定 (Drizzle の withTransaction コールバック内など)
SET LOCAL app.tenant_id = '<ulid>';
```

### 3-2. 解放タイミング

`SET LOCAL` で設定した変数はトランザクション終了 (COMMIT / ROLLBACK) 時に **自動的にリセット**される。
接続プールに返却された後のセッションに残存しないため、明示的なクリアは不要。

> 注意: `SET` (LOCAL なし) を使うとセッション全体に残存し、次のリクエストで意図しない tenant_id が引き継がれる。**必ず `SET LOCAL` を使うこと。**

### 3-3. `app.tenant_id` 未設定で tenant テーブルに触れた場合の挙動

| 状況 | `missing_ok=true` の場合 | `missing_ok=false` の場合 |
|------|-------------------------|--------------------------|
| `app.tenant_id` 未設定 | `NULL` 返却 → 0 行返却 | `ERROR: unrecognized configuration parameter` |
| `app.tenant_id = ''` | 空文字列 → 0 行返却 | 空文字列 → 0 行返却 |

- 本設計は `missing_ok=true` を採用 (§2-4)
- アプリ middleware で tenant_id が解決できない場合は `401 / 403` を返してリクエストを中断し、DB に到達させない

---

## 4. tenant_id index 必須ルール

### 4-1. 必須の理由

RLS ポリシーにより、`tenant` スキーマの全クエリに暗黙的に `WHERE tenant_id = ?` が付与される。
index がない場合はすべての SELECT/UPDATE/DELETE で **全件スキャン (Seq Scan)** が発生し、テナント数・行数に比例してパフォーマンスが劣化する。

### 4-2. 単独 index と複合 index の使い分け

```sql
-- 単独 index: tenant_id 単体でのフィルタが多い場合
CREATE INDEX ON tenant.<table> (tenant_id);

-- 複合 index: よく使うクエリのカラムと組み合わせる
-- 例: tenant_id + created_at で降順ページング
CREATE INDEX ON tenant.<table> (tenant_id, created_at DESC);

-- 例: tenant_id + status でフィルタ
CREATE INDEX ON tenant.<table> (tenant_id, status);
```

複合 index は **`tenant_id` を leftmost prefix** に置くこと。
Postgres の B-tree index は左端から順にプレフィックスを活かすため、
`(tenant_id, ...)` の形であれば `WHERE tenant_id = ?` 単体でも index が使われる。

### 4-3. Drizzle スキーマでの定義ルール

```ts
// tenant スキーマのテーブルは必ず tenant_id index を定義する
export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    // ... 他カラム
  },
  (t) => ({
    tenantIdx: index("bookings_tenant_id_idx").on(t.tenantId),
    // よく使う複合 index も追加する
    tenantCreatedAtIdx: index("bookings_tenant_created_at_idx")
      .on(t.tenantId, t.createdAt),
  })
);
```

- `tenant` スキーマ内の **全テーブル** に `tenant_id` の index を必ず定義する
- Drizzle の `index()` を使い、migration で確実に作成する
- index 名は `<table>_tenant_id_idx` の命名規則に統一する

---

## 5. Migration 実行戦略

### 5-1. 接続文字列の管理

| 環境変数 | role | 用途 |
|----------|------|------|
| `DATABASE_URL` | `app` | アプリ runtime (RLS 適用) |
| `DATABASE_URL_ADMIN` | `admin` | drizzle-kit migration / seed |

- `DATABASE_URL_ADMIN` は CI/CD の Secret Manager に格納し、アプリコンテナには渡さない
- ローカル開発では `.env.local` に分けて管理し、`.gitignore` に含める

### 5-2. drizzle-kit の role 設定

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/**/*.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    // admin role で接続 (RLS bypass + DDL 実行権限)
    url: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!,
  },
});
```

- `drizzle-kit generate` / `drizzle-kit migrate` は `DATABASE_URL_ADMIN` を使う
- `DATABASE_URL_ADMIN` が未設定の場合は `DATABASE_URL` にフォールバックするが、
  CI では必ず `DATABASE_URL_ADMIN` を設定すること

### 5-3. Migration スクリプトでの RLS 設定

drizzle-kit が生成する migration ファイルに RLS 設定を手動で追記する。
drizzle-kit は `CREATE POLICY` を自動生成しないため、`drizzle/migrations/*.sql` に手書きで追加する。

```sql
-- <timestamp>_enable_rls.sql (drizzle/migrations/ に配置)

-- bookings テーブルの例
ALTER TABLE tenant.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant.bookings
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

---

## 6. common schema の保護

### 6-1. app role からのアクセス範囲

```
common.users        → SELECT OK (ログイン解決で自 user レコードを読む)
common.tenants      → SELECT OK (tenant 情報の読み取り)
common.tenant_members → SELECT OK (メンバーシップ確認)
```

書き込みは以下のケースのみ許可:
- `common.tenants` INSERT: テナント作成 (D-6)
- `common.tenant_members` INSERT/UPDATE: 招待受諾 (D-7)

それ以外の書き込みは REVOKE する。

### 6-2. 書き込み制御の 2 案と trade-off

#### 案 A: SECURITY DEFINER 関数経由で書き込みを限定

```sql
-- app role には直接の INSERT を許可しない
REVOKE INSERT ON common.tenants FROM app;

-- SECURITY DEFINER 関数を admin role 所有で作成
CREATE OR REPLACE FUNCTION common.create_tenant(
  p_id text,
  p_name text,
  p_owner_user_id text
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER  -- 関数所有者 (admin) の権限で実行
  SET search_path = common
AS $$
BEGIN
  INSERT INTO common.tenants (id, name) VALUES (p_id, p_name);
  INSERT INTO common.tenant_members (tenant_id, user_id, role)
    VALUES (p_id, p_owner_user_id, 'owner');
END;
$$;

GRANT EXECUTE ON FUNCTION common.create_tenant TO app;
```

**メリット**: DB レベルで書き込み口を限定。不正な INSERT をアプリバグでも防げる。
**デメリット**: 関数の管理コストが増える。Drizzle ORM と相性が悪く、型安全性が下がる。ロジック変更のたびに migration が必要。

#### 案 B: アプリ側 API 制御 (GRANT + アプリ層で保護)

```sql
-- 必要な操作のみ GRANT
GRANT INSERT ON common.tenants TO app;
GRANT INSERT, UPDATE ON common.tenant_members TO app;
```

アプリコードの usecase 層で書き込みを制御し、ルーター側で認可チェックを徹底する。

**メリット**: Drizzle ORM をそのまま使える。型安全性を維持できる。実装がシンプル。
**デメリット**: アプリバグによる意図しない INSERT が DB レベルでは防げない。

#### 推奨

**案 B (アプリ側 API 制御) を採用する。**

理由:
- 本プロジェクトは Drizzle ORM 中心であり、SECURITY DEFINER 関数との混在は型安全性を損なう
- アプリ層での認可チェック (Clerk + middleware) が既に存在し、二重防護が現実的
- 将来的に SECURITY DEFINER 関数への移行は可能だが、MVP フェーズでは不要なコストを避ける

---

## 7. 各 Linear Issue 担当への引き継ぎチェックリスト

本設計書は RLS が主スコープのため、関連する 4 チケット (D-1 / D-2 / D-3 / D-4) に責務を MECE に分解する。

### D-1 (ISH-168) common schema 作成 + users / tenants / tenant_members 配置

> RLS 観点では本書 §6 (common schema の保護方針) を参照。

- [ ] `CREATE SCHEMA common`
- [ ] `common.users` / `common.tenants` / `common.tenant_members` を ULID PK で配置
- [ ] `tenant_members(user_id) UNIQUE` で 1 user = 1 tenant を強制
- [ ] common スキーマは **RLS を有効化しない** (本書 §1, §6 方針)

### D-2 (ISH-169) tenant schema 作成 + tenant_id + index

> RLS 観点では本書 §4 (tenant_id index 必須ルール) を参照。

- [ ] `CREATE SCHEMA tenant`
- [ ] tenant 業務テーブル 8 個を配置、全テーブルに `tenant_id text NOT NULL REFERENCES common.tenants(id)`
- [ ] **全テーブルに `tenant_id` index を必ず定義** (§4-3)
- [ ] Drizzle schema ファイルで `index()` 定義漏れがないことを確認
- [ ] index 命名規則: `<table>_tenant_id_idx`

### D-3 (ISH-170) tenant schema 全テーブルに RLS ポリシー投入

> 本設計書の中核。本書 §1, §2, §5, §6 を実装に落とす。

- [ ] `CREATE ROLE admin WITH BYPASSRLS ...` および `CREATE ROLE app ...` を migration で投入 (§1-2)
- [ ] common スキーマの GRANT/REVOKE を §1-2 通り適用 (app は SELECT のみ、書き込みは個別 GRANT)
- [ ] tenant スキーマの GRANT を §1-2 通り適用 (app に SELECT/INSERT/UPDATE/DELETE)
- [ ] tenant 全テーブルに `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` を適用 (`FORCE` は付けない、§2-1)
- [ ] tenant 全テーブルに `CREATE POLICY tenant_isolation` を適用 (§2-3)
  - [ ] `USING` と `WITH CHECK` の両方を明示する (§2-2)
  - [ ] `current_setting('app.tenant_id', true)` で `missing_ok=true` を使う (§2-4)
- [ ] migration ファイルに RLS 設定 SQL を手動追記する (drizzle-kit は自動生成しない、§5-3)
- [ ] migration は `DATABASE_URL_ADMIN` で実行する
- [ ] `drizzle.config.ts` が `DATABASE_URL_ADMIN` を優先するように更新 (§5-2)
- [ ] PoC: 手動で `SET ROLE app; SET LOCAL app.tenant_id = '...'` した状態で他 tenant の record が見えないことを確認

### D-4 (ISH-171) app role + SET LOCAL app.tenant_id middleware

> 本設計書の §3 (セッション変数) を実装に落とす。

- [ ] アプリ runtime の DB 接続文字列を **`DATABASE_URL` (app role)** に切り替える
- [ ] migration 用接続 (`DATABASE_URL_ADMIN`) はアプリコンテナに渡さない (Secret Manager で分離)
- [ ] `apps/api/src/middleware/auth.ts` (or 直後) に `attachTenantContext` middleware を追加
  - [ ] `common.tenant_members` から user の tenant_id を解決
  - [ ] tenant_id 解決失敗時は 401/403 を返してリクエスト中断 (本書 §3-3)
- [ ] DB クエリを transaction で囲み、開始直後に `SET LOCAL app.tenant_id = '<ulid>'` を発行
- [ ] `wiring.ts` の port builder シグネチャを tenantId 受け取り型に変更
- [ ] `SET` (LOCAL なし) を絶対に使わない (本書 §3-2 注意)
- [ ] integration test:
  - [ ] `app.tenant_id` 未設定で tenant テーブルに触れたら 0 行返却 (§2-4 / §3-3)
  - [ ] tenant A のセッション変数で tenant B の record が一切返らない
- [ ] `app` role が `BYPASSRLS` を持っていないことをセットアップ時に assert
- [ ] ローカル `docker-compose.dev.yml` の postgres ユーザー設定を admin / app の 2 role 構成に対応

---

*作成: ISH-164 / 2026-04-28*
