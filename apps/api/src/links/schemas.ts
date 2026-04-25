import { z } from "zod";

const minute = z.number().int().min(0).max(1440);
const weekday = z.number().int().min(0).max(6);

export const ruleInput = z
  .object({
    weekday,
    startMinute: minute,
    endMinute: minute,
  })
  .refine((r) => r.startMinute < r.endMinute, {
    message: "endMinute must be greater than startMinute",
  });

export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and hyphens only");

export const linkInputSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .max(24 * 60),
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  slotIntervalMinutes: z.number().int().positive().nullable().optional(),
  maxPerDay: z.number().int().positive().nullable().optional(),
  leadTimeHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(0),
  rangeDays: z.number().int().min(1).max(365).default(60),
  timeZone: z.string().min(1),
  isPublished: z.boolean().default(false),
  rules: z.array(ruleInput).default([]),
  excludes: z.array(localDate).default([]),
});

export const linkUpdateSchema = linkInputSchema.partial();

export type LinkInput = z.infer<typeof linkInputSchema>;
export type LinkUpdateInput = z.infer<typeof linkUpdateSchema>;
