export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type AvailabilityRule = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type LinkInput = {
  slug: string;
  title: string;
  description?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number | null;
  maxPerDay: number | null;
  leadTimeHours: number;
  rangeDays: number;
  timeZone: string;
  isPublished: boolean;
  rules: AvailabilityRule[];
  excludes: string[];
};

export type LinkSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  isPublished: boolean;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkDetail = LinkSummary & {
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number | null;
  maxPerDay: number | null;
  leadTimeHours: number;
  rangeDays: number;
  rules: AvailabilityRule[];
  excludes: string[];
};

export const DURATION_CHOICES = [15, 30, 45, 60] as const;
export const SLOT_INTERVAL_CHOICES = [15, 30, 60] as const;
export const BUFFER_CHOICES = [0, 5, 10, 15, 30] as const;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

export const DEFAULT_RANGE_DAYS = 60;
