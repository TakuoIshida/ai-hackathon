import * as stylex from "@stylexjs/stylex";
import { Input } from "@/components/ui/input";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * 公開期間 card — From / To の date input + preset chips。
 *
 * 親コンポーネントが `from` / `to` を持ち、preset chip click で
 * (today, today + days) を計算して `onChange` に渡す。
 *
 * `LinkInput.rangeDays` と一致させるため、parent 側で
 * `to - from = rangeDays` の関係を保つ責務を持つ。本コンポーネントは
 * 純粋に UI 表示と preset 計算のみ。
 */

export interface PublicationPeriodPreset {
  /** Display label, e.g. "1ヶ月". */
  label: string;
  /** Period length in days (used to compute `to`). */
  days: number;
}

export const DEFAULT_PERIOD_PRESETS: ReadonlyArray<PublicationPeriodPreset> = [
  { label: "1週間", days: 7 },
  { label: "2週間", days: 14 },
  { label: "1ヶ月", days: 30 },
  { label: "3ヶ月", days: 90 },
];

export interface PublicationPeriodCardProps {
  /** From date (YYYY-MM-DD). */
  from: string;
  /** To date (YYYY-MM-DD). */
  to: string;
  /** Active preset days, or `null` if user has set a custom range. */
  activeDays: number | null;
  /** Called when from / to / preset changes. */
  onChange: (next: { from: string; to: string; activeDays: number | null }) => void;
  /** Override the default presets if needed. */
  presets?: ReadonlyArray<PublicationPeriodPreset>;
}

const styles = stylex.create({
  card: {
    backgroundColor: colors.bg,
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.lg,
    padding: "1.125rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.625rem",
  },
  title: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: "0.625rem",
  },
  separator: {
    color: colors.ink400,
  },
  presets: {
    display: "flex",
    gap: "0.375rem",
    flexWrap: "wrap",
    marginTop: "0.25rem",
  },
  chip: {
    height: "1.75rem",
    paddingInline: space.md,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    borderRadius: radius.md,
    borderWidth: "1px",
    borderStyle: "solid",
    cursor: "pointer",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: "120ms",
  },
  chipInactive: {
    backgroundColor: colors.bg,
    borderColor: colors.ink200,
    color: colors.ink700,
  },
  chipActive: {
    backgroundColor: colors.blue100,
    borderColor: colors.blue500,
    color: colors.blue700,
  },
});

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function PublicationPeriodCard({
  from,
  to,
  activeDays,
  onChange,
  presets = DEFAULT_PERIOD_PRESETS,
}: PublicationPeriodCardProps) {
  const handlePreset = (days: number) => {
    const today = todayLocal();
    onChange({ from: today, to: addDays(today, days), activeDays: days });
  };

  const cardSx = stylex.props(styles.card);

  return (
    <section className={cardSx.className} style={cardSx.style} aria-label="公開期間">
      <h3 {...stylex.props(styles.title)}>公開期間</h3>
      <div {...stylex.props(styles.row)}>
        <Input
          type="date"
          value={from}
          aria-label="公開期間 開始日"
          onChange={(e) => onChange({ from: e.target.value, to, activeDays: null })}
        />
        <span {...stylex.props(styles.separator)} aria-hidden="true">
          —
        </span>
        <Input
          type="date"
          value={to}
          aria-label="公開期間 終了日"
          onChange={(e) => onChange({ from, to: e.target.value, activeDays: null })}
        />
      </div>
      <div {...stylex.props(styles.presets)}>
        {presets.map((p) => {
          const active = activeDays === p.days;
          const chipSx = stylex.props(
            styles.chip,
            active ? styles.chipActive : styles.chipInactive,
          );
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={active}
              onClick={() => handlePreset(p.days)}
              className={chipSx.className}
              style={chipSx.style}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
