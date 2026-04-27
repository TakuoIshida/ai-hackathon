#!/usr/bin/env bun
// ISH-98: standalone CLI for the reminder cron.
//
// Runs `sendDueReminders` against the production DB + Resend sender.
// Invoked from `.github/workflows/reminders.yml` on a 15-min cron.
//
// Required environment:
//   - DATABASE_URL    (always)
//   - RESEND_API_KEY  (optional in dev; falls back to noopSendEmail)
//   - EMAIL_FROM      (paired with RESEND_API_KEY)
//   - APP_BASE_URL    (used to build /cancel/<token> URLs)
//
// Exit codes:
//   0 — clean run, possibly with `sent === 0`
//   1 — at least one booking failed (counted in result.failed)
//   2 — uncaught exception (DB unreachable, etc.)
//
// ISH-146: `main` and `resolveSendEmail` are exported so the smoke test can
// drive the CLI without spawning a subprocess. Production still goes through
// the `import.meta.main` branch below, identical to the pre-ISH-146 behavior.
import { db } from "@/db/client";
import { sendDueReminders as defaultSendDueReminders } from "@/notifications/reminder-job";
import { createResendSender, loadResendConfig } from "@/notifications/sender";
import { noopSendEmail, type SendEmailFn } from "@/notifications/types";

export function resolveSendEmail(env: NodeJS.ProcessEnv = process.env): SendEmailFn {
  const cfg = loadResendConfig(env);
  return cfg ? createResendSender(cfg) : noopSendEmail;
}

export type RemindersCliDeps = {
  database?: typeof db;
  sendDueReminders?: typeof defaultSendDueReminders;
  sendEmail?: SendEmailFn;
  appBaseUrl?: string;
  exit?: (code: number) => void;
  logger?: Pick<Console, "info" | "error">;
};

export async function main(deps: RemindersCliDeps = {}): Promise<void> {
  const logger = deps.logger ?? console;
  const exit =
    deps.exit ??
    ((code: number) => {
      process.exit(code);
    });
  try {
    const database = deps.database ?? db;
    const sendDueReminders = deps.sendDueReminders ?? defaultSendDueReminders;
    const sendEmail = deps.sendEmail ?? resolveSendEmail();
    const appBaseUrl = deps.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:6173";

    const result = await sendDueReminders(database, { sendEmail, appBaseUrl });
    logger.info("[reminder-job]", JSON.stringify(result));
    if (result.failed > 0) exit(1);
  } catch (err) {
    logger.error("[reminder-job] crashed:", err);
    exit(2);
  }
}

if (import.meta.main) {
  void main();
}
