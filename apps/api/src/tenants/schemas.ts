import { z } from "zod";

export const createTenantBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type CreateTenantBody = z.infer<typeof createTenantBodySchema>;
