import { z } from "zod";

export const createInvitationBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "member"]).default("member"),
});

export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;

export const acceptInvitationParamsSchema = z.object({
  token: z.string().uuid(),
});

export type AcceptInvitationParams = z.infer<typeof acceptInvitationParamsSchema>;
