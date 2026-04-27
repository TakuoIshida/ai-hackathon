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
import { db } from "@/db/client";
import { sendDueReminders } from "@/notifications/reminder-job";
import { createResendSender, loadResendConfig } from "@/notifications/sender";
import { noopSendEmail } from "@/notifications/types";

async function main(): Promise<void> {
  const cfg = loadResendConfig();
  const sendEmail = cfg ? createResendSender(cfg) : noopSendEmail;
  const result = await sendDueReminders(db, {
    sendEmail,
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:6173",
  });
  console.info("[reminder-job]", JSON.stringify(result));
  if (result.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[reminder-job] crashed:", err);
  process.exit(2);
});
