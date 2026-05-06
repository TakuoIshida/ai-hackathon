import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

// ---------------------------------------------------------------------------
// StatCard (ISH-232)
//
// `links-list` / `team-members` などダッシュボード上部の Stats row に使う
// "icon-tile + label + value (+ sub)" の汎用 component。
// tone は Pastel Blue palette (ISH-229) の 5 種類 (blue / mint / lilac / amber
// / rose) のうちから選び、icon-tile の background と icon color が tone-100 /
// tone-500 の組で切り替わる。
// ---------------------------------------------------------------------------

const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
    fontFamily: typography.fontFamilySans,
  },
  iconTile: {
    width: "2.25rem",
    height: "2.25rem",
    borderRadius: "0.625rem",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  toneBlue: {
    backgroundColor: colors.blue100,
    color: colors.blue500,
  },
  toneMint: {
    backgroundColor: colors.mint100,
    color: colors.mint500,
  },
  toneLilac: {
    backgroundColor: colors.lilac100,
    color: colors.lilac500,
  },
  toneAmber: {
    backgroundColor: colors.amber100,
    color: colors.amber500,
  },
  toneRose: {
    backgroundColor: colors.rose100,
    color: colors.rose500,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "0.125rem",
    minWidth: 0,
  },
  label: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
    margin: 0,
    lineHeight: typography.lineHeightTight,
  },
  valueRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.375rem",
  },
  value: {
    fontSize: typography.fontSizeXl,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    lineHeight: typography.lineHeightTight,
  },
  total: {
    fontSize: typography.fontSizeSm,
    color: colors.ink500,
  },
  sub: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
    margin: 0,
    lineHeight: typography.lineHeightTight,
  },
});

const toneMap = {
  blue: styles.toneBlue,
  mint: styles.toneMint,
  lilac: styles.toneLilac,
  amber: styles.toneAmber,
  rose: styles.toneRose,
} as const;

export type StatCardTone = keyof typeof toneMap;

export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Top label (small, ink500). e.g. "アクティブなリンク" */
  label: string;
  /** Main value. Rendered large + bold. */
  value: string | number;
  /** Optional secondary text. Shown below the value row in ink500. */
  sub?: string;
  /** Optional total. When set, renders as "<value> / <total>". */
  total?: number;
  /** Icon node — typically a `lucide-react` icon. Inherits `currentColor`. */
  icon: React.ReactNode;
  /** Color tone. Drives icon-tile bg + icon color. */
  tone: StatCardTone;
}

export const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, sub, total, icon, tone, style, ...props }, ref) => {
    const cardSx = stylex.props(styles.card);
    const tileSx = stylex.props(styles.iconTile, toneMap[tone]);
    return (
      <div
        ref={ref}
        data-tone={tone}
        {...props}
        className={cardSx.className}
        style={{ ...cardSx.style, ...style }}
      >
        <div
          data-testid="stat-card-icon-tile"
          className={tileSx.className}
          style={tileSx.style}
          aria-hidden
        >
          {icon}
        </div>
        <div {...stylex.props(styles.body)}>
          <p {...stylex.props(styles.label)}>{label}</p>
          <div {...stylex.props(styles.valueRow)}>
            <span {...stylex.props(styles.value)}>{value}</span>
            {total !== undefined && <span {...stylex.props(styles.total)}>/ {total}</span>}
          </div>
          {sub && <p {...stylex.props(styles.sub)}>{sub}</p>}
        </div>
      </div>
    );
  },
);
StatCard.displayName = "StatCard";
