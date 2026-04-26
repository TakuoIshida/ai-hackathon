export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailFn = (message: EmailMessage) => Promise<void>;

export const noopSendEmail: SendEmailFn = async () => {
  // intentionally empty — used when RESEND_API_KEY is absent so booking confirm
  // still succeeds in dev / unit tests without Resend wired up.
};
