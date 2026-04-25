import type { Interval } from "./types";

export function isValidInterval(i: Interval): boolean {
  return Number.isFinite(i.start) && Number.isFinite(i.end) && i.start < i.end;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function clamp(i: Interval, bounds: Interval): Interval | null {
  const start = Math.max(i.start, bounds.start);
  const end = Math.min(i.end, bounds.end);
  return start < end ? { start, end } : null;
}

export function mergeIntervals(intervals: ReadonlyArray<Interval>): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].filter(isValidInterval).sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  for (const next of sorted) {
    const last = result[result.length - 1];
    if (last && next.start <= last.end) {
      last.end = Math.max(last.end, next.end);
    } else {
      result.push({ start: next.start, end: next.end });
    }
  }
  return result;
}

export function subtractIntervals(
  base: ReadonlyArray<Interval>,
  cut: ReadonlyArray<Interval>,
): Interval[] {
  const merged = mergeIntervals(cut);
  const result: Interval[] = [];
  for (const b of base) {
    let segments: Interval[] = [{ start: b.start, end: b.end }];
    for (const c of merged) {
      const next: Interval[] = [];
      for (const s of segments) {
        if (!overlaps(s, c)) {
          next.push(s);
          continue;
        }
        if (s.start < c.start) next.push({ start: s.start, end: c.start });
        if (c.end < s.end) next.push({ start: c.end, end: s.end });
      }
      segments = next;
      if (segments.length === 0) break;
    }
    result.push(...segments);
  }
  return result;
}

export function intersectAny(target: Interval, intervals: ReadonlyArray<Interval>): boolean {
  for (const i of intervals) if (overlaps(target, i)) return true;
  return false;
}
