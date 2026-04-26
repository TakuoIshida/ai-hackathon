import { z } from "zod";

// Slug shape mirrors links/schemas.ts::slugSchema. Lowercase alphanumeric and
// hyphens, 1..64 characters. Uniqueness is enforced by a DB UNIQUE constraint
// on workspaces.slug; the route layer translates the conflict into a 409.
export const workspaceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and hyphens only");

export const createWorkspaceInputSchema = z.object({
  name: z.string().min(1).max(200),
  slug: workspaceSlugSchema,
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
