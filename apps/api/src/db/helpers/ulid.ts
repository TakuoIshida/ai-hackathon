import { text } from "drizzle-orm/pg-core";
import { ulid } from "ulidx";

/** PK 用: text PRIMARY KEY (default はアプリ側生成) */
export const ulidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => ulid());
