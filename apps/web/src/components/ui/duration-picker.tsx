import * as stylex from "@stylexjs/stylex";
import { colors, radius, typography } from "@/styles/tokens.stylex";

/**
 * DurationPicker — 4 列 grid の chip-button group。
 *
 * 主に "所要時間" の入力に使うが、`choices` を差し替えれば任意の number 配列に
 * 対応する汎用 chip group。aria-label を渡すと group label として読み上げ可。
 */

const DEFAULT_CHOICES = [15, 30, 45, 60] as const;

export interface DurationPickerProps {
  value: number;
  onChange: (next: number) => void;
  choices?: ReadonlyArray<number>;
  /** Accessible label for the radiogroup. */
  "aria-label"?: string;
  /** Suffix appended to the displayed number (default: "分"). */
  unit?: string;
  /** ID for the radiogroup root. */
  id?: string;
}

const styles = stylex.create({
  root: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "0.5rem",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: "0.625rem",
    paddingInline: 0,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.ink700,
    backgroundColor: colors.bg,
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: colors.ink200,
    borderRadius: radius.md,
    cursor: "pointer",
    transitionProperty: "background-color, color, border-color",
    transitionDuration: "120ms",
    outline: "none",
  },
  chipActive: {
    backgroundColor: colors.blue100,
    color: colors.blue700,
    borderColor: colors.blue500,
  },
});

export function DurationPicker({
  value,
  onChange,
  choices = DEFAULT_CHOICES,
  unit = "分",
  id,
  ...rest
}: DurationPickerProps) {
  const ariaLabel = rest["aria-label"];
  const rootSx = stylex.props(styles.root);
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      className={rootSx.className}
      style={rootSx.style}
    >
      {choices.map((m) => {
        const active = m === value;
        const chipSx = stylex.props(styles.chip, active && styles.chipActive);
        return (
          // biome-ignore lint/a11y/useSemanticElements: Chip-button styled grid; we expose radio semantics via aria so the visible element can be a `<button>` rather than `<input type="radio">`.
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(m)}
            className={chipSx.className}
            style={chipSx.style}
          >
            {m}
            {unit}
          </button>
        );
      })}
    </div>
  );
}
