import { describe, expect, test } from "bun:test";
import type { db } from "@/db/client";
import type { ReminderJobResult } from "@/notifications/reminder-job";
import { noopSendEmail } from "@/notifications/types";
import { main, resolveSendEmail } from "./reminders";

// The CLI never touches `db` because we always inject `database` here.
// `db` is a Proxy whose properties are only resolved on access, so this
// stub is safe as long as `sendDueReminders` is also injected.
const fakeDb = {} as unknown as typeof db;

const stubResult = (over: Partial<ReminderJobResult> = {}): ReminderJobResult => ({
  considered: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  ...over,
});

describe("resolveSendEmail (env → sender)", () => {
  test("RESEND_API_KEY 未設定 → noopSendEmail フォールバック", () => {
    expect(resolveSendEmail({} as NodeJS.ProcessEnv)).toBe(noopSendEmail);
  });

  test("EMAIL_FROM だけ設定 → noopSendEmail フォールバック", () => {
    expect(resolveSendEmail({ EMAIL_FROM: "no-reply@example.com" } as NodeJS.ProcessEnv)).toBe(
      noopSendEmail,
    );
  });

  test("RESEND_API_KEY + EMAIL_FROM 設定 → resend sender(noop ではない)", () => {
    const sender = resolveSendEmail({
      RESEND_API_KEY: "re_test_x",
      EMAIL_FROM: "owner@example.com",
    } as NodeJS.ProcessEnv);
    expect(sender).not.toBe(noopSendEmail);
    expect(typeof sender).toBe("function");
  });
});

describe("main (CLI orchestration)", () => {
  test("due 0 件 → exit を呼ばず stdout に `{considered:0,...}` JSON を出力", async () => {
    const exits: number[] = [];
    const infos: string[] = [];
    await main({
      database: fakeDb,
      sendDueReminders: async () => stubResult(),
      sendEmail: noopSendEmail,
      appBaseUrl: "https://app.example.com",
      exit: (code) => exits.push(code),
      logger: {
        info: (...args) => infos.push(args.map(String).join(" ")),
        error: () => {},
      },
    });
    expect(exits).toEqual([]);
    const line = infos.find((l) => l.startsWith("[reminder-job]"));
    expect(line).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(line!).toContain('"considered":0');
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(line!).toContain('"sent":0');
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(line!).toContain('"failed":0');
  });

  test("sent > 0 / failed === 0 → exit を呼ばない(=exit code 0)", async () => {
    const exits: number[] = [];
    await main({
      database: fakeDb,
      sendDueReminders: async () => stubResult({ considered: 3, sent: 3 }),
      sendEmail: noopSendEmail,
      appBaseUrl: "https://app.example.com",
      exit: (code) => exits.push(code),
      logger: { info: () => {}, error: () => {} },
    });
    expect(exits).toEqual([]);
  });

  test("failed > 0 → exit(1)", async () => {
    const exits: number[] = [];
    await main({
      database: fakeDb,
      sendDueReminders: async () => stubResult({ considered: 5, sent: 3, skipped: 1, failed: 1 }),
      sendEmail: noopSendEmail,
      appBaseUrl: "https://app.example.com",
      exit: (code) => exits.push(code),
      logger: { info: () => {}, error: () => {} },
    });
    expect(exits).toEqual([1]);
  });

  test("sendDueReminders が throw → exit(2) かつ error log を出力", async () => {
    const exits: number[] = [];
    const errors: unknown[][] = [];
    await main({
      database: fakeDb,
      sendDueReminders: async () => {
        throw new Error("DB unreachable");
      },
      sendEmail: noopSendEmail,
      appBaseUrl: "https://app.example.com",
      exit: (code) => exits.push(code),
      logger: { info: () => {}, error: (...args) => errors.push(args) },
    });
    expect(exits).toEqual([2]);
    const matched = errors.some((args) =>
      args.some((a) => a instanceof Error && a.message === "DB unreachable"),
    );
    expect(matched).toBe(true);
  });

  test("appBaseUrl は sendDueReminders の deps に伝搬する", async () => {
    let captured: { appBaseUrl?: string } = {};
    await main({
      database: fakeDb,
      sendDueReminders: async (_db, deps) => {
        captured = { appBaseUrl: deps.appBaseUrl };
        return stubResult();
      },
      sendEmail: noopSendEmail,
      appBaseUrl: "https://reminder.test.local",
      exit: () => {},
      logger: { info: () => {}, error: () => {} },
    });
    expect(captured.appBaseUrl).toBe("https://reminder.test.local");
  });
});
