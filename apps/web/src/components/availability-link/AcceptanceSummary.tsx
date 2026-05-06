import * as stylex from "@stylexjs/stylex";
import type { AvailabilityRule, Weekday } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * 右パネル下部の "受付サマリー" card。
 *
 * - 受付曜日 (例: "月〜金", "月,水,金", "未設定")
 * - 合計受付時間 (例: "32時間 / 週")
 * - 予約可能枠 (`durationMinutes` 分割)
 *
 * 計算は rules + duration から純粋に導出する pure component。
 */

export interface AcceptanceSummaryProps {
  rules: ReadonlyArray<AvailabilityRule>;
  durationMinutes: number;
}

const DAY_ORDER: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5, 6, 0];

/**
 * Format the active weekdays as a compact string.
 *
 * - empty → "未設定"
 * - contiguous run → "月〜金"
 * - non-contiguous → "月, 水, 金" (joined)
 *
 * "Contiguous" is checked using DAY_ORDER (Mon-first, Sun-last).
 */
export function formatActiveDaysLabel(activeWeekdays: ReadonlyArray<Weekday>): string {
  if (activeWeekdays.length === 0) return "未設定";

  // Sort by DAY_ORDER position
  const sorted = [...activeWeekdays].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

  if (sorted.length === 1) return WEEKDAY_LABELS[sorted[0] as Weekday];

  // Detect a single contiguous run
  let contiguous = true;
  for (let i = 1; i < sorted.length; i++) {
    const prev = DAY_ORDER.indexOf(sorted[i - 1] as Weekday);
    const curr = DAY_ORDER.indexOf(sorted[i] as Weekday);
    if (curr - prev !== 1) {
      contiguous = false;
      break;
    }
  }

  if (contiguous && sorted.length >= 3) {
    return `${WEEKDAY_LABELS[sorted[0] as Weekday]}〜${WEEKDAY_LABELS[sorted[sorted.length - 1] as Weekday]}`;
  }

  return sorted.map((wd) => WEEKDAY_LABELS[wd]).join(", ");
}

/**
 * Compute total minutes-per-week across all rules.
 */
export function computeTotalMinutesPerWeek(rules: ReadonlyArray<AvailabilityRule>): number {
  let sum = 0;
  for (const r of rules) {
    const span = r.endMinute - r.startMinute;
    if (span > 0) sum += span;
  }
  return sum;
}

const styles = stylex.create({
  card: {
    backgroundColor: colors.blue50,
    border: `1px solid ${colors.blue150}`,
    borderRadius: radius.lg,
    padding: "0.875rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  title: {
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.blue700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBlockEnd: space.sm,
    margin: 0,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: typography.fontSizeSm,
    color: colors.blue900,
  },
  label: {},
  value: {
    fontWeight: typography.fontWeightBold,
  },
});

export function AcceptanceSummary({ rules, durationMinutes }: AcceptanceSummaryProps) {
  const activeWeekdays = Array.from(new Set(rules.map((r) => r.weekday as Weekday)));
  const daysLabel = formatActiveDaysLabel(activeWeekdays);
  const totalMin = computeTotalMinutesPerWeek(rules);
  const hours = Math.round((totalMin / 60) * 10) / 10; // 1 桁
  const slots = durationMinutes > 0 ? Math.floor(totalMin / durationMinutes) : 0;

  return (
    <section {...stylex.props(styles.card)} aria-label="受付サマリー">
      <p {...stylex.props(styles.title)}>受付サマリー</p>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.label)}>受付曜日</span>
        <span {...stylex.props(styles.value)}>{daysLabel}</span>
      </div>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.label)}>合計受付時間</span>
        <span {...stylex.props(styles.value)}>{hours}時間 / 週</span>
      </div>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.label)}>予約可能枠 ({durationMinutes}分)</span>
        <span {...stylex.props(styles.value)}>{slots} 枠 / 週</span>
      </div>
    </section>
  );
}
