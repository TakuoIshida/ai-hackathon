# common / tenant schema 割り振り表 (ISH-166)

> 作成日: 2026-04-28
> ステータス: 確定済み設計書 — 実装は D-1 / D-2 / D-3 で行う

## 概要

企業単位アカウント化に向けて、全テーブルを **common** / **tenant** の 2 schema に分割する。

- **common schema**: 認証・マルチテナント管理に関わるテーブル (3 本)
- **tenant schema**: 業務データのテーブル (8 本)

RLS は tenant schema の全テーブルに適用し、`tenant_id` カラムで行レベルの分離を担保する。

> RLS の詳細設計 (role / セッション変数 / ポリシー) は **P-3 (`docs/design/rls.md`)** を、
> ULID 生成方針 (アプリ側 `$defaultFn` / セキュリティトークンの扱い) は **P-5 (`docs/design/ulid.md`)** を参照。本書はそれらと整合させた割り振り表。

---

## 1. schema 一覧 (大表)

| schema | table | 主要カラム | PK 型 | tenant_id | index on tenant_id | RLS | 備考 |
|---|---|---|---|---|---|---|---|
| common | users | external_id (clerk_id), email, name, timezone | text(ULID) | ❌ | - | ❌ | Clerk 認証解決用。1 row = 1 Clerk ユーザー |
| common | tenants | name, created_at | text(ULID) | ❌ | - | ❌ | テナントマスタ。旧 `workspaces` を rename |
| common | tenant_members | user_id, tenant_id, role | text(ULID) | ❌ (列は存在するが RLS 非適用) | - | ❌ | `UNIQUE(user_id)` で 1 user = 1 tenant を強制。旧 `memberships` を rename |
| tenant | invitations | tenant_id, email, token, role, expires_at | text(ULID) | ✅ | ✅ | ✅ | `UNIQUE(tenant_id, token)` / open 招待は `(tenant_id, email)` partial unique。**token は UUIDv4** (P-5 参照) |
| tenant | availability_links | tenant_id, user_id, slug, title, ... | text(ULID) | ✅ | ✅ | ✅ | slug は global unique のまま維持 |
| tenant | availability_rules | tenant_id, link_id, weekday, start_minute, end_minute | text(ULID) | ✅ | ✅ | ✅ | link_id 経由でも tenant 特定可能だが直接付与 |
| tenant | availability_excludes | tenant_id, link_id, local_date | text(ULID) | ✅ | ✅ | ✅ | |
| tenant | bookings | tenant_id, link_id, start_at, end_at, guest_*, status | text(ULID) | ✅ | ✅ | ✅ | confirmed 重複防止 partial unique も維持。**cancellation_token は UUIDv4** (P-5 参照) |
| tenant | link_owners | tenant_id, link_id, user_id | text(ULID) | ✅ | ✅ | ✅ | co-owner 管理 |
| tenant | google_oauth_accounts | tenant_id, user_id, google_user_id, encrypted_refresh_token, ... | text(ULID) | ✅ | ✅ | ✅ | |
| tenant | google_calendars | tenant_id, oauth_account_id, google_calendar_id, ... | text(ULID) | ✅ | ✅ | ✅ | |

---

## 2. テーブルごとのカラム定義

### 変換ルール共通

- PK を `uuid` → `text(ULID, 26 文字)` に変更。**ULID 生成はアプリ側** (Drizzle の `$defaultFn(() => ulid())`)。DB 側に `DEFAULT` は付与しない
- 既存の `uuid` FK も同様に `text` へ変更
- tenant schema の全テーブルに `tenant_id text NOT NULL` を追加し `INDEX` を張る
- **セキュリティトークン** (`bookings.cancellation_token`, `invitations.token`) は ULID 化せず **UUIDv4 を維持** (時刻露出回避、詳細は P-5 参照)

---

### 2-1. common.users

旧: `public.users`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID (アプリ側 `$defaultFn` で生成) |
| external_id | text | NOT NULL, UNIQUE | 旧 `clerk_id`。外部 IdP の識別子 |
| email | text | NOT NULL | |
| name | text | | nullable |
| time_zone | text | NOT NULL, DEFAULT 'Asia/Tokyo' | |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | |

```sql
-- id の DEFAULT は付与しない (Drizzle の $defaultFn でアプリ側生成)
CREATE TABLE common.users (
  id          text        PRIMARY KEY,
  external_id text        NOT NULL UNIQUE,  -- 旧 clerk_id
  email       text        NOT NULL,
  name        text,
  time_zone   text        NOT NULL DEFAULT 'Asia/Tokyo',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

---

### 2-2. common.tenants

旧: `public.workspaces` → **rename**

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID (アプリ側 `$defaultFn` で生成) |
| name | text | NOT NULL | 旧 `workspaces.name` |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | |

> 旧 `workspaces.slug` と `owner_user_id` は削除。slug は API レイヤーで不要になり、owner は `tenant_members.role = 'owner'` で表現する。

```sql
CREATE TABLE common.tenants (
  id         text        PRIMARY KEY,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

### 2-3. common.tenant_members

旧: `public.memberships` → **rename**

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID (アプリ側 `$defaultFn` で生成) |
| user_id | text(26) | NOT NULL, FK → common.users(id), UNIQUE | **UNIQUE 単独制約で 1 user = 1 tenant を強制** |
| tenant_id | text(26) | NOT NULL, FK → common.tenants(id) | |
| role | text | NOT NULL, DEFAULT 'member' | CHECK IN ('owner','member') |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |

```sql
CREATE TABLE common.tenant_members (
  id        text        PRIMARY KEY,
  user_id   text        NOT NULL UNIQUE  -- 1 user = 1 tenant 強制
            REFERENCES common.users(id) ON DELETE CASCADE,
  tenant_id text        NOT NULL
            REFERENCES common.tenants(id) ON DELETE CASCADE,
  role      text        NOT NULL DEFAULT 'member'
            CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- tenant_id にも検索用 index
CREATE INDEX idx_tenant_members_tenant ON common.tenant_members(tenant_id);
```

> 旧 `memberships` は `UNIQUE(workspace_id, user_id)` の複合 unique だったが、
> 新設計では `UNIQUE(user_id)` 単独に変更し「1 user は必ず 1 tenant にのみ所属」を DB レベルで強制する。

---

### 2-4. tenant.invitations

旧: `public.invitations` (workspace_id → tenant_id に rename)

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, FK → common.tenants(id), INDEX | |
| email | text | NOT NULL | |
| token | uuid | NOT NULL, UNIQUE, DEFAULT gen_random_uuid() | **UUIDv4 維持** (時刻露出回避、P-5 参照) |
| role | text | NOT NULL, DEFAULT 'member' | CHECK IN ('owner','member') |
| invited_by_user_id | text(26) | NOT NULL, FK → common.users(id) | |
| expires_at | timestamptz | NOT NULL | |
| accepted_at | timestamptz | | NULL = 未受理 |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |

制約:
- `UNIQUE(tenant_id, token)` — トークンは事実上 global unique だが念のため
- `UNIQUE(tenant_id, email) WHERE accepted_at IS NULL` — open 招待の重複防止

---

### 2-5. tenant.availability_links

旧: `public.availability_links`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| user_id | text(26) | NOT NULL, FK → common.users(id) | |
| slug | varchar(64) | NOT NULL, UNIQUE | global unique を維持 |
| title | text | NOT NULL | |
| description | text | | |
| duration_minutes | integer | NOT NULL, CHECK > 0 | |
| buffer_before_minutes | integer | NOT NULL, DEFAULT 0 | |
| buffer_after_minutes | integer | NOT NULL, DEFAULT 0 | |
| slot_interval_minutes | integer | | |
| max_per_day | integer | | |
| lead_time_hours | integer | NOT NULL, DEFAULT 0 | |
| range_days | integer | NOT NULL, DEFAULT 60 | |
| time_zone | text | NOT NULL | |
| is_published | boolean | NOT NULL, DEFAULT false | |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | |

---

### 2-6. tenant.availability_rules

旧: `public.availability_rules`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| link_id | text(26) | NOT NULL, FK → tenant.availability_links(id) ON DELETE CASCADE, INDEX | |
| weekday | smallint | NOT NULL, CHECK 0-6 | 0=日, 6=土 |
| start_minute | smallint | NOT NULL, CHECK 0-1440 | |
| end_minute | smallint | NOT NULL, CHECK 0-1440, > start_minute | |

---

### 2-7. tenant.availability_excludes

旧: `public.availability_excludes`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| link_id | text(26) | NOT NULL, FK → tenant.availability_links(id) ON DELETE CASCADE | |
| local_date | varchar(10) | NOT NULL, CHECK 'YYYY-MM-DD' format | |

制約: `UNIQUE(link_id, local_date)`

---

### 2-8. tenant.bookings

旧: `public.bookings`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| link_id | text(26) | NOT NULL, FK → tenant.availability_links(id) ON DELETE RESTRICT | |
| start_at | timestamptz | NOT NULL | |
| end_at | timestamptz | NOT NULL, CHECK > start_at | |
| guest_name | text | NOT NULL | |
| guest_email | text | NOT NULL | |
| guest_note | text | | |
| guest_time_zone | text | | |
| status | varchar(16) | NOT NULL, DEFAULT 'confirmed', CHECK IN ('confirmed','canceled') | |
| google_event_id | text | | |
| meet_url | text | | |
| cancellation_token | uuid | NOT NULL, UNIQUE, DEFAULT gen_random_uuid() | **UUIDv4 維持** (時刻露出回避、P-5 参照) |
| reminder_sent_at | timestamptz | | |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| canceled_at | timestamptz | | |

制約:
- `INDEX(link_id, start_at)`
- `INDEX(status, start_at)`
- `UNIQUE(link_id, start_at) WHERE status = 'confirmed'` — 同一スロット重複防止

---

### 2-9. tenant.link_owners

旧: `public.link_owners`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| link_id | text(26) | NOT NULL, FK → tenant.availability_links(id) ON DELETE CASCADE | |
| user_id | text(26) | NOT NULL, FK → common.users(id) ON DELETE CASCADE | |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |

制約: `UNIQUE(link_id, user_id)`

---

### 2-10. tenant.google_oauth_accounts

旧: `public.google_oauth_accounts`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| user_id | text(26) | NOT NULL, FK → common.users(id) ON DELETE CASCADE | |
| google_user_id | text | NOT NULL | |
| email | text | NOT NULL | |
| encrypted_refresh_token | text | NOT NULL | AES-GCM 暗号化済み |
| refresh_token_iv | text | NOT NULL | |
| refresh_token_auth_tag | text | NOT NULL | |
| access_token | text | | |
| access_token_expires_at | timestamptz | | |
| scope | text | NOT NULL | |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | |

制約: `UNIQUE(user_id, google_user_id)`

---

### 2-11. tenant.google_calendars

旧: `public.google_calendars`

| カラム | 型 | 制約 | 備考 |
|---|---|---|---|
| id | text(26) | PK | ULID |
| tenant_id | text(26) | NOT NULL, INDEX | |
| oauth_account_id | text(26) | NOT NULL, FK → tenant.google_oauth_accounts(id) ON DELETE CASCADE | |
| google_calendar_id | text | NOT NULL | |
| summary | text | | |
| time_zone | text | | |
| is_primary | boolean | NOT NULL, DEFAULT false | |
| used_for_busy | boolean | NOT NULL, DEFAULT true | |
| used_for_writes | boolean | NOT NULL, DEFAULT false | |
| created_at | timestamptz | NOT NULL, DEFAULT now() | |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | |

制約: `UNIQUE(oauth_account_id, google_calendar_id)`

---

## 3. tenant_members の制約詳細

### 1 user = 1 tenant の強制

```sql
-- user_id 単独 UNIQUE により 1 user が複数 tenant に所属することを DB レベルで禁止
ALTER TABLE common.tenant_members
  ADD CONSTRAINT tenant_members_user_id_key UNIQUE (user_id);
```

将来、兼任要件 (1 人が複数企業に所属) が発生した場合は、この UNIQUE 制約を DROP するだけで対応可能。アプリケーションコードは「現 tenant の tenant_id を取得する」ロジックを追加するのみ。

### role の実装選択

2 つの選択肢を提示する:

**Option A: Postgres ENUM**
```sql
CREATE TYPE common.member_role AS ENUM ('owner', 'member');
ALTER TABLE common.tenant_members
  ALTER COLUMN role TYPE common.member_role USING role::common.member_role;
```
- メリット: DB レベルで値を保証、インデックス効率が良い
- デメリット: ENUM 追加は `ALTER TYPE ... ADD VALUE` だが削除は不可 (要 type 再作成)

**Option B: text + CHECK 制約 (採用)**
```sql
CHECK (role IN ('owner', 'member'))
```
- メリット: 変更が容易
- デメリット: アプリ側での型安全は TypeScript の `as const` に依存

現フェーズでは **Option B (text + CHECK)** を採用し、安定後に ENUM へ昇格を検討する。

---

## 4. 将来の workspace 後付けシナリオ

### 方針

workspace は **権限境界にしない**。RLS は `tenant_id` のままにし、workspace は「分類タグ」として扱う。

### 後付け時に追加するテーブル

```sql
-- tenant schema に追加
CREATE TABLE tenant.workspaces (
  id         text        PRIMARY KEY,
  tenant_id  text        NOT NULL REFERENCES common.tenants(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspaces_tenant ON tenant.workspaces(tenant_id);

CREATE TABLE tenant.workspace_members (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  workspace_id text        NOT NULL REFERENCES tenant.workspaces(id) ON DELETE CASCADE,
  user_id      text        NOT NULL REFERENCES common.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX idx_workspace_members_tenant ON tenant.workspace_members(tenant_id);
```

> 後付け時もこれらの新テーブルは tenant schema 配下に置き、`tenant_id` を持たせて **RLS 対象** に含める (P-3 のポリシーを同様に適用)。workspace は権限境界ではないが、tenant 境界の RLS は引き続き効かせる。

### 既存テーブルへの workspace_id 追加 ALTER 例

```sql
-- 分類タグとして追加 (NULL 許容)
ALTER TABLE tenant.availability_links
  ADD COLUMN workspace_id text REFERENCES tenant.workspaces(id) ON DELETE SET NULL;

ALTER TABLE tenant.bookings
  ADD COLUMN workspace_id text REFERENCES tenant.workspaces(id) ON DELETE SET NULL;
-- 他テーブルも同様
```

### 既存 record の backfill 戦略

| 戦略 | 内容 | 採用場面 |
|---|---|---|
| NULL のまま運用 | workspace 未設定 = 「未分類」扱い | 段階的移行。UI で「未分類」を表示 |
| default workspace 自動作成 | テナントごとに "Default" workspace を作成し既存 record を紐付け | 全 record に workspace_id を設定したい場合 |

RLS ポリシーは `tenant_id` のみを参照し、`workspace_id` は一切参照しない。アプリケーション層のフィルタリングで workspace 絞り込みを行う。

---

## 5. GRANT 戦略 (admin / app role 別)

> role 名・セッション変数・RLS ポリシーの詳細は P-3 (`docs/design/rls.md`) を正とする。本書では割り振りに必要な範囲のみ抜粋。

### role 定義

| role | 用途 |
|---|---|
| `app` | アプリサーバー (Hono) が使用する実行 role。RLS 適用 |
| `admin` | マイグレーション実行・緊急オペレーション用の管理 role。`BYPASSRLS` 付与 |

### common schema

```sql
-- app は SELECT のみを基本とし、書き込みは個別 GRANT で限定
GRANT USAGE ON SCHEMA common TO app;
GRANT SELECT ON ALL TABLES IN SCHEMA common TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA common
  GRANT SELECT ON TABLES TO app;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA common FROM app;

-- 書き込みが必要なオペレーションだけ個別 GRANT
GRANT INSERT ON common.tenants TO app;            -- D-6 tenant 作成
GRANT INSERT, UPDATE ON common.tenant_members TO app;  -- D-7 招待受諾
GRANT INSERT, UPDATE ON common.users TO app;     -- onboarding / プロフィール更新

-- admin は全権
GRANT ALL ON SCHEMA common TO admin;
GRANT ALL ON ALL TABLES IN SCHEMA common TO admin;
```

### tenant schema

```sql
-- app は全 CRUD (RLS で行レベル制限を受ける)
GRANT USAGE ON SCHEMA tenant TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant TO app;

-- 将来追加されるテーブルにも自動適用
ALTER DEFAULT PRIVILEGES IN SCHEMA tenant
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;

-- admin は全権
GRANT ALL ON SCHEMA tenant TO admin;
GRANT ALL ON ALL TABLES IN SCHEMA tenant TO admin;
```

### RLS ポリシー (tenant schema 全テーブル共通パターン)

```sql
ALTER TABLE tenant.<table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenant.<table_name>
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
```

> セッション変数 `app.tenant_id` は接続スコープのトランザクション内で `SET LOCAL app.tenant_id = '<ulid>'` でセットする (詳細は P-3 §3)。
> `current_setting(..., true)` の `missing_ok=true` により未設定時は NULL → 0 行返却で silent fail (P-3 §2-4)。

---

## 6. 引き継ぎチェックリスト (Linear Issue ベース)

本書の主スコープは D-1 / D-2 (schema 配置)。RLS / role 作成は D-3 のスコープに切り出し、MECE に責務分担する。

### D-1 (ISH-168) common schema 作成 + users / tenants / tenant_members 配置

- [ ] `common` schema を CREATE する
- [ ] `common.users` を作成 (旧 `public.users` の PK を uuid → text ULID に変更、`clerk_id` → `external_id` rename)
- [ ] `common.tenants` を作成 (旧 `public.workspaces` を rename + ULID 化、`slug` / `owner_user_id` 削除)
- [ ] `common.tenant_members` を作成 (旧 `public.memberships` を rename + ULID 化、`workspace_id` → `tenant_id` rename、`UNIQUE(user_id)` 追加)
- [ ] PK / FK は `text` 型 + アプリ側 ULID 生成 (DB の `DEFAULT` は付与しない)
- [ ] `common.tenant_members(tenant_id)` に検索用 INDEX
- [ ] Drizzle スキーマファイルを `apps/api/src/db/schema/common.ts` に整理 (旧 `users.ts` / `workspaces.ts` を統合)

### D-2 (ISH-169) tenant schema 作成 + tenant_id + index

- [ ] `tenant` schema を CREATE する
- [ ] 以下 8 テーブルを `tenant` schema に配置し ULID 化する:
  - [ ] `invitations` (`workspace_id` → `tenant_id` に rename、`token` は **UUIDv4 維持**)
  - [ ] `availability_links` (`tenant_id` カラム追加)
  - [ ] `availability_rules` (`tenant_id` カラム追加)
  - [ ] `availability_excludes` (`tenant_id` カラム追加)
  - [ ] `bookings` (`tenant_id` カラム追加、`cancellation_token` は **UUIDv4 維持**)
  - [ ] `link_owners` (`tenant_id` カラム追加)
  - [ ] `google_oauth_accounts` (`tenant_id` カラム追加)
  - [ ] `google_calendars` (`tenant_id` カラム追加)
- [ ] **全 8 テーブルの `tenant_id` に INDEX を作成** (P-3 §4 / P-5 helper 限界を参照)
- [ ] PK / FK は `text` 型 + アプリ側 ULID 生成 (DB の `DEFAULT` は付与しない)
- [ ] Drizzle スキーマファイルを `apps/api/src/db/schema/tenant.ts` に整理
- [ ] `bun drizzle-kit generate` で migration ファイルを生成・検証

### D-3 (ISH-170) RLS ポリシー投入

> 詳細手順は P-3 (`docs/design/rls.md`) §7 を参照。本書からは role / GRANT / RLS の責務をすべて D-3 に渡す。

- [ ] `CREATE ROLE admin WITH BYPASSRLS ...` および `CREATE ROLE app ...` を migration で投入
- [ ] §5 の GRANT/REVOKE を common / tenant 双方に適用
- [ ] tenant 全テーブルに `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation`
- [ ] `current_setting('app.tenant_id', true)` を使い missing_ok=true で 0 行返却にする
- [ ] migration ファイルに RLS 設定 SQL を手動追記 (drizzle-kit は自動生成しない)

### 共通確認事項

- [ ] 全テーブルの PK が `text(ULID 26 文字)` であること、`DEFAULT generate_ulid()` 等の DB 関数は使っていないこと
- [ ] `common.tenant_members(user_id)` に UNIQUE 制約が存在すること
- [ ] `tenant.*` の全テーブルに `tenant_id text NOT NULL` が存在すること
- [ ] `tenant.*` の全テーブルの `tenant_id` に INDEX が存在すること
- [ ] `public` schema に旧テーブルが残っていないこと (移行後に DROP)
- [ ] アプリケーションコード (`apps/api/src/`) の Drizzle クエリが新 schema を参照していること
- [ ] 既存の integration テスト (`*.test.ts`) が新スキーマで通過すること

---

## 付録: rename / 廃止対応表

| 旧テーブル (public schema) | 新テーブル (schema 付き) | 変更内容 |
|---|---|---|
| `public.users` | `common.users` | PK ULID 化、`clerk_id` → `external_id` rename |
| `public.workspaces` | `common.tenants` | テーブル rename、ULID 化、`slug`/`owner_user_id` 削除 |
| `public.memberships` | `common.tenant_members` | テーブル rename、ULID 化、`workspace_id` → `tenant_id`、`UNIQUE(user_id)` 追加 |
| `public.invitations` | `tenant.invitations` | schema 移動、PK のみ ULID 化、**token は UUIDv4 維持**、`workspace_id` → `tenant_id` |
| `public.availability_links` | `tenant.availability_links` | schema 移動、ULID 化、`tenant_id` 追加 |
| `public.availability_rules` | `tenant.availability_rules` | schema 移動、ULID 化、`tenant_id` 追加 |
| `public.availability_excludes` | `tenant.availability_excludes` | schema 移動、ULID 化、`tenant_id` 追加 |
| `public.bookings` | `tenant.bookings` | schema 移動、PK のみ ULID 化、**cancellation_token は UUIDv4 維持**、`tenant_id` 追加 |
| `public.link_owners` | `tenant.link_owners` | schema 移動、ULID 化、`tenant_id` 追加 |
| `public.google_oauth_accounts` | `tenant.google_oauth_accounts` | schema 移動、ULID 化、`tenant_id` 追加 |
| `public.google_calendars` | `tenant.google_calendars` | schema 移動、ULID 化、`tenant_id` 追加 |
