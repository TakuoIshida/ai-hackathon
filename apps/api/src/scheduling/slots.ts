import { intersectAny, mergeIntervals } from "./intervals";
import type { ComputeSlotsInput, Slot } from "./types";

const MIN = 60_000;

export function computeAvailableSlots(input: ComputeSlotsInput): Slot[] {
  const {
    rangeStart,
    rangeEnd,
    windows,
    busy,
    durationMinutes,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    slotIntervalMinutes,
    maxPerDay,
  } = input;

  if (rangeStart >= rangeEnd) return [];
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];

  const stepMinutes = slotIntervalMinutes ?? durationMinutes;
  if (!Number.isFinite(stepMinutes) || stepMinutes <= 0) return [];

  const durationMs = durationMinutes * MIN;
  const stepMs = stepMinutes * MIN;
  const bufferBeforeMs = bufferBeforeMinutes * MIN;
  const bufferAfterMs = bufferAfterMinutes * MIN;

  const mergedBusy = mergeIntervals(busy);

  const slots: Slot[] = [];
  const perDayCount = new Map<string, number>();

  for (const win of windows) {
    if (win.end - win.start < durationMs) continue;

    const winEnd = Math.min(win.end, rangeEnd);
    if (winEnd - win.start < durationMs) continue;

    const minStart = Math.max(win.start, rangeStart);
    const stepsToSkip = Math.max(0, Math.ceil((minStart - win.start) / stepMs));
    const firstStart = win.start + stepsToSkip * stepMs;
    const lastStart = winEnd - durationMs;

    for (let s = firstStart; s <= lastStart; s += stepMs) {
      const slotEnd = s + durationMs;
      if (intersectAny({ start: s - bufferBeforeMs, end: slotEnd + bufferAfterMs }, mergedBusy)) {
        continue;
      }

      if (maxPerDay !== undefined) {
        const count = perDayCount.get(win.localDate) ?? 0;
        if (count >= maxPerDay) break;
        perDayCount.set(win.localDate, count + 1);
      }

      slots.push({ start: s, end: slotEnd });
    }
  }

  return slots;
}
