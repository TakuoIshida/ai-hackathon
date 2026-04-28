import { text } from "drizzle-orm/pg-core";
import { ulid } from "ulidx";

/** PK 用: text PRIMARY KEY (default はアプリ側生成) */
export const ulidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => ulid());

/** tenant_id 用: text NOT NULL (アプリ側で値を渡す。INDEX は別途定義必須) */
export const tenantId = () => text("tenant_id").notNull();
