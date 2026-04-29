# Multi-tenant 化 本番デプロイ Runbook

ISH-184 / ISH-185 / ISH-186 の手順を上から順に実行する。

前提:
- Cloud SQL (Postgres 17) の本番インスタンスが既に provision 済 (ISH-155 / 162 / 163 で対応済)
- Render に `ai-hackathon-api` と `ai-hackathon-web` がデプロイ済
- 現在 main ブランチに multi-tenant 化のコードが merge 済 (PR #80 〜 #101)
- 本 runbook の作業は **prod / staging 環境** に対して行う

所要時間目安: **30 〜 60 分** (DB migration 数分、env 反映待ち含む)

---

## Phase 0. 事前準備 (5 分)

### 0-A. 既存データの有無を確認 (ISH-184)

> **重要**: \`0002_tenant-schema.sql\` は \`DROP TABLE public.bookings\` などの破壊的操作を含む。本番にユーザデータが入っている場合、データ消失する。

- [ ] superuser で接続して既存テーブルの行数を確認
  ```bash
  psql "$DATABASE_URL_ADMIN" <<'EOF'
  SELECT 'public.users' AS t, count(*) FROM public.users
  UNION ALL SELECT 'public.workspaces', count(*) FROM public.workspaces
  UNION ALL SELECT 'public.bookings', count(*) FROM public.bookings
  UNION ALL SELECT 'public.availability_links', count(*) FROM public.availability_links;
  EOF
  ```
- [ ] **判定:**
  - 全テーブル 0 件 (ハッカソン状態) → そのまま Phase 1 へ進む (ISH-184 no-op 適用)
  - **データあり** → ⚠️ **STOP** — 本 runbook の Phase 1 を実行すると消える。先に backfill script を作成 (separate issue)、本 runbook は中断
- [ ] 判定結果を Linear ISH-184 に記録 (no-op か、新規 backfill issue を切ったか)

### 0-B. バックアップ + パスワード準備

- [ ] Cloud SQL の **手動スナップショット** を取得
  - GCP Console → Cloud SQL → 該当インスタンス → 「Backups」→「Create backup」
  - 名前例: `pre-multi-tenant-rollout-2026-04-29`
- [ ] 強パスワードを 2 つ生成してパスマネージャ / GCP Secret Manager に保存
  ```bash
  openssl rand -base64 32 | tr -d '/+='   # admin role 用
  openssl rand -base64 32 | tr -d '/+='   # app role 用
  ```
- [ ] Cloud SQL Auth Proxy をローカルで起動 (migration 流す用)
  ```bash
  cloud-sql-proxy --port 5433 PROJECT:REGION:INSTANCE
  ```
- [ ] superuser (postgres) で接続確認
  ```bash
  psql "postgresql://postgres:$POSTGRES_PW@127.0.0.1:5433/app_prod" -c "SELECT version();"
  ```

---

## Phase 1. Migration dry-run + 適用 (ISH-184 / R-1)

### Dry-run (本番に流さず確認)

- [ ] ローカルの最新 `apps/api/drizzle/` を確認
  ```bash
  ls apps/api/drizzle/   # 0000_baseline 0001_common-schema 0002_tenant-schema 0003_rls
  cat apps/api/drizzle/meta/_journal.json | jq '.entries[].tag'
  ```
- [ ] **prod の現状 migration** を確認 (適用済 tag のリスト)
  ```bash
  psql "$DATABASE_URL_ADMIN" -c "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;"
  ```
  - 0000_baseline までしか流れていない (= multi-tenant 前) ことを確認
- [ ] 各 migration SQL の内容を目視レビュー
  - `0001_common-schema.sql` — common.users / tenants / tenant_members の DDL
  - `0002_tenant-schema.sql` — 8 tenant tables + tenant_id NOT NULL + index
  - `0003_rls.sql` — admin/app role 作成 (dev password) + RLS policy 適用
- [ ] **dry-run**: テーブル一覧と行数を記録 (rollback 時の参照値)
  ```bash
  psql "$DATABASE_URL_ADMIN" -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','common','tenant') ORDER BY schemaname, tablename;"
  psql "$DATABASE_URL_ADMIN" -c "SELECT 'public.users' AS t, count(*) FROM public.users UNION ALL SELECT 'public.workspaces', count(*) FROM public.workspaces;"
  ```

### Apply

- [ ] Render の API service を **maintenance mode** に切り替え (orハードコードで 503 を返す bypass)
  - 簡易版: API の Render dashboard で `Manual Deploy` を一時停止し、新規リクエストが流れない時間帯を選ぶ
- [ ] `DATABASE_URL_ADMIN` env を superuser URL でセットしてローカルから migrate
  ```bash
  cd apps/api
  DATABASE_URL_ADMIN="postgresql://postgres:$POSTGRES_PW@127.0.0.1:5433/app_prod" \
    bun run db:migrate
  ```
- [ ] 適用結果を確認
  - `common` / `tenant` schema が存在
  - `pg_roles` に `admin` / `app` がある
  - `pg_policies` に 8 tenant table の `tenant_isolation` policy がある
  ```bash
  psql "$DATABASE_URL_ADMIN" -c "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('admin','app');"
  psql "$DATABASE_URL_ADMIN" -c "SELECT count(*) FROM pg_policies WHERE schemaname='tenant' AND policyname='tenant_isolation';"
  # → 期待値: admin (true), app (false), policy count = 8
  ```

### Rollback (失敗時のみ)

- [ ] Phase 0 で取った backup から restore
  - GCP Console → Backups → 「Restore」→ 元インスタンスを上書き or 新インスタンスに復元

---

## Phase 2. admin / app role のパスワード rotation + Auth Proxy 配線 (ISH-185 / R-2)

### Password rotation

- [ ] superuser psql で `docs/operations/rotate-rls-passwords.sql` の手順に従い実行
  ```bash
  psql "$DATABASE_URL_ADMIN" <<EOF
  \set admin_pw '$ADMIN_PW'
  \set app_pw '$APP_PW'
  ALTER ROLE admin WITH PASSWORD :'admin_pw';
  ALTER ROLE app   WITH PASSWORD :'app_pw';
  EOF
  ```
- [ ] 新 password で接続できることを確認
  ```bash
  psql "postgresql://app:$APP_PW@127.0.0.1:5433/app_prod" -c "SELECT 1;"
  psql "postgresql://admin:$ADMIN_PW@127.0.0.1:5433/app_prod" -c "SELECT 1;"
  ```
- [ ] 旧 dev password (`'admin'` / `'app'`) でログインできないことを確認
  ```bash
  psql "postgresql://app:app@127.0.0.1:5433/app_prod" -c "SELECT 1;"   # → FATAL: password authentication failed
  ```

### Cloud SQL Auth Proxy (Render 経由) の準備

- [ ] Render の API service 用に **2 種類の DATABASE_URL** を準備:
  - `DATABASE_URL` (= app role、runtime 用)  
    `postgresql://app:$APP_PW@127.0.0.1:5432/app_prod` (Cloud SQL Auth Proxy via sidecar)
  - `DATABASE_URL_ADMIN` (= admin role、migration 用)  
    `postgresql://admin:$ADMIN_PW@127.0.0.1:5432/app_prod`
- [ ] それぞれを GCP Secret Manager / Render Environment Group に格納

### 確認

- [ ] migration runner だけ admin URL を、API runtime は app URL を使う設計を Render env で表現できているか確認
  - migrate は CI / 手動 (`bun run db:migrate`) で `DATABASE_URL_ADMIN` を使う
  - runtime は API container が `DATABASE_URL` (app) を使う

---

## Phase 3. Render env を app role に切替 (ISH-186 / R-3)

- [ ] Render dashboard → `ai-hackathon-api` → Environment → `DATABASE_URL` の値を更新
  - 旧: `postgresql://postgres:$POSTGRES_PW@host/db`
  - 新: `postgresql://app:$APP_PW@host/db?sslmode=require`
- [ ] 新規 deploy をトリガ (env 変更で auto-redeploy がかかる設定なら不要)
- [ ] `/health` が 200 を返すことを確認
  ```bash
  curl https://ai-hackathon-api.onrender.com/health
  # → {"ok":true,"service":"api"}
  ```
- [ ] 認証済 endpoint で smoke test
  - dashboard にログイン → /links が表示される (空でも 200)
  - 新規 user で onboarding → tenant 作成
  - public booking flow (`/${slug}` で予約)

### 動作確認のチェックポイント

- [ ] **app role が想定通り RLS に従っている**
  - 別 tenant の URL を踏むと 404 (cross-tenant isolation)
- [ ] **migration 用 admin URL は runtime で使われていない**
  - `pg_stat_activity` で接続中の usename を確認: app のみ
  ```bash
  psql "$DATABASE_URL_ADMIN" -c "SELECT usename, count(*) FROM pg_stat_activity WHERE datname='app_prod' GROUP BY usename;"
  ```
- [ ] reminder cron / webhook など API 以外のジョブも env を更新しているか確認 (ISH-187 関連)

### Rollback (失敗時のみ)

- [ ] Render env の `DATABASE_URL` を superuser URL に戻して redeploy
- [ ] DB backup から restore (Phase 0 のスナップショット)

---

## 完了基準 (3 phase 共通)

- [ ] `/health` 200
- [ ] cross-tenant 404 が e2e で返る
- [ ] `pg_stat_activity` で API 接続が `app` role のみ
- [ ] 旧 dev password でログイン不可
- [ ] CI が green (main ブランチで `bun test` / e2e)

---

## 関連 Linear

- ISH-184 (R-1): Migration dry-run + apply
- ISH-185 (R-2): admin/app role 設定 + Auth Proxy
- ISH-186 (R-3): Render env 切替
- ISH-187 (R-4): reminder cron など他ジョブの env 更新 (本 runbook 範囲外、別途対応)
- ISH-197: hard-coded password 撤去のための前提 (本 runbook の Phase 2 で実施)
