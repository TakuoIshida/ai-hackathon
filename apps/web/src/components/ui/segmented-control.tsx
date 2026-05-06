import * as stylex from "@stylexjs/stylex";
import type * as React from "react";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

/**
 * Pill-shaped segmented control (e.g. for switching between mutually exclusive
 * modes such as "calendar" / "form"). Rendered as a tab list / radio-group
 * hybrid: keyboard navigation works via arrow keys (radio semantics).
 *
 * 後続 issue でも汎用的に使う想定なので、value / onChange / options で完結
 * させる。icon は任意。
 */

export interface SegmentedControlOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<V extends string = string> {
  value: V;
  onChange: (next: V) => void;
  options: ReadonlyArray<SegmentedControlOption<V>>;
  /** Accessible label for the radiogroup (recommended). */
  "aria-label"?: string;
  /** Optional id for the radiogroup root. */
  id?: string;
}

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.125rem",
    padding: "0.1875rem",
    backgroundColor: colors.ink100,
    borderRadius: radius.full,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
    paddingInline: "0.875rem",
    paddingBlock: "0.3125rem",
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
    color: colors.ink500,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: radius.full,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transitionProperty: "background-color, color, box-shadow",
    transitionDuration: "120ms",
    outline: "none",
  },
  itemActive: {
    backgroundColor: colors.bg,
    color: colors.blue700,
    fontWeight: typography.fontWeightBold,
    boxShadow: shadow.sm,
  },
});

/**
 * SegmentedControl — keyboard navigable pill toggle.
 *
 * 実装メモ: Radix RadioGroup primitive を流用すると label を icon + text の
 * 組み合わせで描きにくいので、role="radiogroup" + role="radio" の手書きで実装。
 * ArrowLeft / ArrowRight で循環移動。
 */
export function SegmentedControl<V extends string = string>({
  value,
  onChange,
  options,
  id,
  ...rest
}: SegmentedControlProps<V>) {
  const ariaLabel = rest["aria-label"];
  const rootSx = stylex.props(styles.root);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = options[(idx + 1) % options.length];
      if (next) onChange(next.value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = options[(idx - 1 + options.length) % options.length];
      if (next) onChange(next.value);
    }
  };

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      className={rootSx.className}
      style={rootSx.style}
    >
      {options.map((opt, idx) => {
        const active = opt.value === value;
        const itemSx = stylex.props(styles.item, active && styles.itemActive);
        return (
          // biome-ignore lint/a11y/useSemanticElements: Visual pill toggle styled around a `button`; an `<input type="radio">` cannot host the icon + label markup we render here, so we expose radio semantics via aria.
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={itemSx.className}
            style={itemSx.style}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
