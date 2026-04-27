# 全テーブル PK/FK ULID 化戦略 (ISH-189)

## 背景と目的

本プロジェクトは「企業単位アカウント化 (マルチテナント化)」の準備フェーズとして、全テーブル (現状 11 テーブル) の PK/FK を UUID から ULID に統一する。

**確定済み前提**

- PK/FK の型: `text` (ULID Crockford Base32, 26 文字)
- ULID 生成: アプリ側 (`$defaultFn`) — DB の `gen_random_uuid()` は使わない
- `tenant_id` も同じ ULID 方針 (将来フェーズで追加)
- 本番未稼働のため既存マイグレーション (0000〜0004) は破棄して baseline 再生成 OK

---

## 1. ULID ライブラリ選定

### 候補比較

| 項目 | `ulid` | `ulidx` |
|---|---|---|
| TypeScript 型定義 | DefinitelyTyped (`@types/ulid`) | バンドル済み (`.d.ts` 同梱) |
| ESM サポート | CJS のみ (ESM は非公式 workaround) | ESM ネイティブ + CJS デュアル |
| Monotonic 生成 | `monotonicFactory()` あり | `monotonicFactory()` あり |
| バンドルサイズ | ~2 KB (minified+gzip) | ~3 KB (minified+gzip) |
| 最終更新 | 2019 年以降ほぼ停滞 | 2024 年も継続メンテ |
| Bun 互換性 | 動作するが CJS 解決が必要 | ESM でそのまま動作 |

### 推奨: `ulidx`

**根拠**

1. **Bun + ESM ネイティブ**: このプロジェクトは Bun ランタイムで ESM を前提としており、`ulidx` は ESM ファーストで設計されているため `import { ulid } from "ulidx"` がそのまま動く。`ulid` は CJS 前提で ESM バンドル時に shim が必要になるケースがある。
2. **TypeScript 型が同梱**: `@types/ulid` を別途追加しなくて済む。依存が 1 パッケージで完結する。
3. **継続メンテ**: `ulid` は 2019 年以降実質的にアーカイブ状態。`ulidx` は 2024 年もコミットがあり、セキュリティ対応が期待できる。
4. **monotonic サポート**: 同一ミリ秒内の単調増加が必要になった場合も同じ API パターンで対応できる (後述)。

```typescript
// インストール (D-0 で実施)
// bun add ulidx  (apps/api workspace)

import { ulid } from "ulidx";
ulid(); // => "01HWZXK3MFGJ5Q2VRBE8T4CZHN"
```

---

## 2. Drizzle helper 設計

### ファイル配置

```
apps/api/src/db/helpers/ulid.ts   ← 新規作成
```

### helper 定義サンプル

```typescript
// apps/api/src/db/helpers/ulid.ts
import { text } from "drizzle-orm/pg-core";
import { ulid } from "ulidx";

/** PK 用: id text PRIMARY KEY DEFAULT (ulid()) */
export const ulidPk = () =>
  text("id").primaryKey().$defaultFn(() => ulid());

/** tenant_id 用: tenant_id text NOT NULL (index 必須) */
export const tenantId = () =>
  text("tenant_id").notNull();
```

> FK は helper を作らず `text("foo_id").notNull().references(() => parent.id)` を **直書き**する。
> 1 段ラップ helper を作っても `.references(...)` が呼び出し側必須なことに変わりはなく、helper 化により「FK には ULID 専用ロジックがある」という誤解を生むだけで意味がない。

### 使用例

```typescript
// apps/api/src/db/schema/users.ts (書き換え後イメージ)
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantId, ulidFk, ulidPk } from "../helpers/ulid";

export const users = pgTable("users", {
  id: ulidPk(),
  tenantId: tenantId(),          // 将来フェーズで追加
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

### 2 パターン helper の使い分け

| helper | 用途 | 備考 |
|---|---|---|
| `ulidPk()` | PK (全テーブル) | `$defaultFn` でアプリ生成、DB default なし |
| `tenantId()` | テナント識別子 | カラム定義のみ共通化。**index は別途定義必須** (後述) |

### Helper の限界 — index 漏れリスク

`tenantId()` helper はカラム定義のみを共通化するため、RLS で必須となる **`(tenant_id)` index は別途 `index()` で定義する必要があり、helper だけでは付与されない**。

```typescript
export const bookings = pgTable("bookings",
  {
    id: ulidPk(),
    tenantId: tenantId(),  // ← helper はここまで
    // ...
  },
  (t) => [
    // ↓ index は別 chain で必ず追加する。これが漏れると性能崩壊
    index("bookings_tenant_idx").on(t.tenantId),
  ],
);
```

**index 漏れの自動検出**: tenant スキーマ配下のテーブルで `tenantId()` を呼んでいるのに `index(...).on(t.tenantId)` がない場合に CI で fail させる軽量 lint (例: `bun run scripts/lint-tenant-index.ts`) を別途用意する案を検討する。実装は本タスク対象外。

---

## 3. テーブル定義の書き換え方針

### 現状の schema ファイル構成 (5 ファイル 11 テーブル)

| ファイル | テーブル |
|---|---|
| `users.ts` | `users` |
| `workspaces.ts` | `workspaces`, `memberships`, `invitations` |
| `links.ts` | `availability_links`, `availability_rules`, `availability_excludes`, `link_owners` |
| `bookings.ts` | `bookings` |
| `google.ts` | `google_oauth_accounts`, `google_calendars` |

### 書き換え手順

**ステップ 1: helper 追加**

`apps/api/src/db/helpers/ulid.ts` を作成する (前節のコードをそのままコピー)。

**ステップ 2: 各 schema ファイルの PK/FK を置き換える**

```diff
-  id: uuid("id").defaultRandom().primaryKey(),
+  id: ulidPk(),

-  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
+  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
```

PK は `ulidPk()` helper、FK は `text(...).notNull().references(...)` の **直書き**で統一する。`uuid` 型のインポートをすべて削除し、`ulidPk` および `text` を必要に応じてインポートする。

**ステップ 3: セキュリティトークンは ULID 化しない**

`bookings.cancellation_token` や `invitations.token` は **「推測困難」を要件とするシークレットトークン**であり、PK/FK とは性質が異なる。

ULID は先頭 10 文字がタイムスタンプ (ミリ秒精度) なので、**トークンを通じて生成時刻が外部に露出する**。エントロピーは 80 bit ありブルートフォース耐性自体は十分だが、時刻情報の漏洩は予測攻撃やレースコンディション攻撃のヒントになりうる。

**方針**: トークンは **UUIDv4 維持** (現行の `defaultRandom()` をそのまま使う)。

| 候補 | エントロピー | 評価 |
|---|---|---|
| **UUIDv4** (採用) | 122 bit | 既存実装と互換、依存追加なし、時刻露出なし |
| `nanoid` (21 文字) | 126 bit | URL safe、長さ短い、依存追加が必要 |
| ULID | 80 bit | lex-sortable は不要、時刻露出が懸念 |

```diff
// 変更しない (現行を維持)
   cancellationToken: uuid("cancellation_token").defaultRandom().notNull().unique(),
   token:             uuid("token").defaultRandom().notNull().unique(),
```

**注意点**

- `onDelete` / `onUpdate` の cascade/restrict 設定は現行通り引き継ぐ
- 複合 unique index (`uniqueIndex`) はカラム名変更がないため変更不要
- セキュリティトークン以外の PK/FK はすべて ULID 化対象 (この境界を MECE に守る)

---

## 4. Migration baseline 戦略

### 既存マイグレーション (0000〜0004) の破棄

本番は未稼働のため、incremental migration ではなく **baseline 再生成** を採用する。

```
apps/api/drizzle/
├── 0000_left_wendell_rand.sql   ← 削除
├── 0001_flawless_tag.sql        ← 削除
├── 0002_workspaces_memberships.sql ← 削除
├── 0003_link_owners.sql         ← 削除
├── 0004_invitations.sql         ← 削除
└── meta/
    ├── _journal.json            ← エントリを空配列にリセット or 削除して再生成
    └── *.json スナップショット  ← 削除
```

### baseline 再生成手順 (D-0 で実施)

```bash
# 1. 古いマイグレーションを削除
rm -rf apps/api/drizzle/

# 2. スキーマ書き換え後、drizzle-kit で baseline を生成
cd apps/api
bunx drizzle-kit generate --name=baseline
# => drizzle/0000_baseline.sql が生成される
```

`_journal.json` は `drizzle-kit generate` が自動で再生成する。手書きで編集する必要はない。

### ローカル DB 再作成手順

```bash
# Docker Compose でローカル Postgres を使っている場合
docker compose down -v   # ボリュームごと削除
docker compose up -d

# マイグレーション適用
cd apps/api
bun run db:migrate
```

チームメンバーへの周知ポイント:
- `docker compose down -v` でローカルデータはすべて消える
- seed が必要な場合は `bun run db:seed` を別途実行する

---

## 5. Index 観点

### text PK の B-tree コスト

ULID は **Crockford Base32** でエンコードされた 26 文字の文字列であり、先頭 10 文字がタイムスタンプ (ミリ秒精度)、後続 16 文字がランダム部で構成される。

- **lex-sortable**: 生成順にソートすると文字列順と一致するため、B-tree への挿入が UUID v4 (完全ランダム) と比べてページ分割が少ない
- **UUID との比較**: UUID v4 は完全ランダムなためページ分割が頻繁に起きる。ULID はタイムスタンプ昇順なので末尾ページへの追記が基本となり、キャッシュヒット率も高い
- **text vs uuid 型**: Postgres では `uuid` 型は 16 バイト固定だが、`text` の ULID は 26 バイト。インデックスサイズは若干大きくなるが、B-tree フレンドリーなソート特性で相殺できる

### tenant_id index 必須ルール

マルチテナント対応 (RLS) を見据え、`tenant_id` を持つテーブルは以下のルールを適用する。

1. `tenant_id` 単独インデックスを必ず付与する
2. テナント単位で絞り込む全クエリが `WHERE tenant_id = $1` を先頭条件として使う

```typescript
(t) => [
  index("idx_users_tenant").on(t.tenantId),
  // ...
]
```

### 複合 index の leftmost prefix

複合インデックス `(tenant_id, created_at)` はクエリ `WHERE tenant_id = $1 ORDER BY created_at` に有効。
`tenant_id` を leftmost prefix にすることで、テナント単独フィルタと複合フィルタの両方をカバーできる。

### `(tenant_id, id)` 複合 index の検討

| パターン | 有利なケース | 不利なケース |
|---|---|---|
| PK (id 単独) + tenant_id 単独インデックス | PK ルックアップ + テナント一覧の各クエリが独立して最適化される | 2 つのインデックスを維持するコスト |
| `(tenant_id, id)` 複合インデックス | `WHERE tenant_id = $1 AND id = $2` のルックアップが 1 スキャンで済む | id 単独ルックアップには使えない (rightmost prefix は使えない) |

**方針**: PK は id 単独で B-tree に乗る。tenant_id 単独インデックスを必須とし、ホットクエリの実測後に `(tenant_id, id)` 複合インデックスを追加するかどうか判断する。最初から両方張ると書き込みオーバーヘッドが増えるため、実績ベースで追加する。

---

## 6. 動作確認

### lex-sortable 性質の確認テスト

ULID が挿入順に `ORDER BY id` で並ぶことを確認するテスト例:

```typescript
// apps/api/src/db/helpers/ulid.test.ts
import { expect, test } from "bun:test";
import { ulid } from "ulidx";

test("ULID は生成時刻順にソートされる", () => {
  // 1 ms 間隔で生成
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(ulid(Date.now() + i)); // 各 ms を明示
  }
  const sorted = [...ids].sort();
  expect(sorted).toEqual(ids); // lex order === 生成順
});

test("ULID は 26 文字 Crockford Base32 文字のみで構成される", () => {
  const id = ulid();
  expect(id).toHaveLength(26);
  expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});
```

### Monotonic 生成の方針

同一ミリ秒内に大量の行を INSERT するユースケース (バッチ処理など) では、ランダム部が衝突する確率は実用上無視できる (2^80 通り)。

ただし、**厳密な挿入順序の保証**が必要な場合は `monotonicFactory` を使う:

```typescript
// apps/api/src/db/helpers/ulid.ts (monotonic 版)
import { monotonicFactory } from "ulidx";
const ulidMonotonic = monotonicFactory();

// 同一 ms 内でも単調増加を保証
ulidMonotonic(); // => ランダム部を +1 ずつインクリメント
```

**本プロジェクトでの判断**: 初期フェーズでは通常の `ulid()` を使う。API はリクエスト単位で 1 行 INSERT が基本であり、同一ミリ秒内の衝突リスクは無視できる。バッチ処理が増えた場合に monotonic 版へ切り替える。
