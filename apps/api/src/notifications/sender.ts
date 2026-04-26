import type { EmailMessage, SendEmailFn } from "./types";

type FetchLike = typeof fetch;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type ResendConfig = {
  apiKey: string;
  from: string;
};

export function loadResendConfig(env: NodeJS.ProcessEnv = process.env): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export function createResendSender(cfg: ResendConfig, fetchImpl: FetchLike = fetch): SendEmailFn {
  return async (msg: EmailMessage) => {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend ${res.status}: ${body}`);
    }
  };
}
