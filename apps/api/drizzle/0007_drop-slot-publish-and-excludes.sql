-- ISH-298: スロット設定 / 休日除外 / 公開設定 を全廃するための destructive migration。
--
-- 削除対象:
--   - tenant.availability_links から slot 系 / publish 系 6 column
--     - buffer_before_minutes
--     - buffer_after_minutes
--     - slot_interval_minutes
--     - max_per_day
--     - lead_time_hours
--     - is_published
--   - tenant.availability_excludes table 全体 (休日除外機能ごと撤去)
--
-- データロス: 該当 column / 行は完全に消失する。Neon dev DB 前提。
-- 既存の RLS policy (tenant_isolation) は ON DELETE/DROP CASCADE で
-- 自動的にクリーンアップされる。

ALTER TABLE "tenant"."availability_links"
	DROP COLUMN IF EXISTS "buffer_before_minutes",
	DROP COLUMN IF EXISTS "buffer_after_minutes",
	DROP COLUMN IF EXISTS "slot_interval_minutes",
	DROP COLUMN IF EXISTS "max_per_day",
	DROP COLUMN IF EXISTS "lead_time_hours",
	DROP COLUMN IF EXISTS "is_published";

DROP TABLE IF EXISTS "tenant"."availability_excludes" CASCADE;
