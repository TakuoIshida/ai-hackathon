import { z } from "zod";
import type { CreateLinkCommand, UpdateLinkCommand } from "./domain";

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

// Wire-format types stay internal to this module + its sidecar test.
// repo / usecase consume `CreateLinkCommand` / `UpdateLinkCommand` from
// `./domain` instead — see `toCreateLinkCommand` / `toUpdateLinkCommand`.
type LinkInput = z.infer<typeof linkInputSchema>;
type LinkUpdateInput = z.infer<typeof linkUpdateSchema>;

/**
 * Convert the parsed wire format from `linkInputSchema` to a domain command.
 * Normalizes the `nullable + optional` fields to a strict `T | null` so the
 * repo never sees `undefined` for these slots (ISH-124).
 */
export function toCreateLinkCommand(input: LinkInput): CreateLinkCommand {
  return {
    slug: input.slug,
    title: input.title,
    description: input.description ?? null,
    durationMinutes: input.durationMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    bufferAfterMinutes: input.bufferAfterMinutes,
    slotIntervalMinutes: input.slotIntervalMinutes ?? null,
    maxPerDay: input.maxPerDay ?? null,
    leadTimeHours: input.leadTimeHours,
    rangeDays: input.rangeDays,
    timeZone: input.timeZone,
    isPublished: input.isPublished,
    rules: input.rules,
    excludes: input.excludes,
  };
}

/**
 * Same idea for the partial update path. Only the keys present in the patch
 * are forwarded; missing keys stay missing so the repo's UPDATE statement
 * leaves the column untouched.
 */
export function toUpdateLinkCommand(input: LinkUpdateInput): UpdateLinkCommand {
  const out: UpdateLinkCommand = {};
  if (input.slug !== undefined) out.slug = input.slug;
  if (input.title !== undefined) out.title = input.title;
  if (input.description !== undefined) out.description = input.description;
  if (input.durationMinutes !== undefined) out.durationMinutes = input.durationMinutes;
  if (input.bufferBeforeMinutes !== undefined) out.bufferBeforeMinutes = input.bufferBeforeMinutes;
  if (input.bufferAfterMinutes !== undefined) out.bufferAfterMinutes = input.bufferAfterMinutes;
  if (input.slotIntervalMinutes !== undefined) out.slotIntervalMinutes = input.slotIntervalMinutes;
  if (input.maxPerDay !== undefined) out.maxPerDay = input.maxPerDay;
  if (input.leadTimeHours !== undefined) out.leadTimeHours = input.leadTimeHours;
  if (input.rangeDays !== undefined) out.rangeDays = input.rangeDays;
  if (input.timeZone !== undefined) out.timeZone = input.timeZone;
  if (input.isPublished !== undefined) out.isPublished = input.isPublished;
  if (input.rules !== undefined) out.rules = input.rules;
  if (input.excludes !== undefined) out.excludes = input.excludes;
  return out;
}
