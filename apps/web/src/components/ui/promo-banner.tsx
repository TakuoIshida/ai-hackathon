import * as stylex from "@stylexjs/stylex";
import { Sparkles } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

// 注: tokens.stylex の `defineVars` で定義した値は CSS 変数 (var(--xxx)) として
// 展開されるため、`linear-gradient` / `radial-gradient` の引数にそのまま埋め込め
// る。StyleX が静的解析できるよう、テンプレートリテラルは create() 内で完結
// させる。
const styles = stylex.create({
  banner: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: space.md,
    paddingInline: "22px",
    paddingBlock: "18px",
    borderRadius: radius.lg,
    border: `1px solid ${colors.blue150}`,
    overflow: "hidden",
    backgroundImage: `linear-gradient(95deg, ${colors.blue50} 0%, ${colors.blue100} 60%, ${colors.lilac100} 110%)`,
    fontFamily: typography.fontFamilySans,
  },
  // dot pattern overlay — 12×12 grid radial gradient, opacity 0.18
  dotOverlay: {
    position: "absolute",
    inset: 0,
    backgroundImage: `radial-gradient(${colors.blue300} 1px, transparent 1px)`,
    backgroundSize: "12px 12px",
    opacity: 0.18,
    pointerEvents: "none",
  },
  iconTile: {
    position: "relative",
    flexShrink: 0,
    width: "44px",
    height: "44px",
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    display: "grid",
    placeItems: "center",
    boxShadow: shadow.sm,
    color: colors.blue600,
  },
  textCol: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  title: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
    lineHeight: typography.lineHeightTight,
  },
  description: {
    fontSize: typography.fontSizeXs,
    color: colors.ink700,
    margin: 0,
    lineHeight: typography.lineHeightNormal,
  },
  actions: {
    position: "relative",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
  },
});

export interface PromoBannerAction {
  label: string;
  onClick?: () => void;
}

export interface PromoBannerProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Bold heading line. */
  title: string;
  /** Smaller secondary line. */
  description?: string;
  /** Right-aligned primary action (filled). */
  primaryAction?: PromoBannerAction;
  /** Right-aligned secondary action (ghost). */
  secondaryAction?: PromoBannerAction;
  /** Custom icon for the left tile. Defaults to a sparkle. */
  icon?: React.ReactNode;
}

export const PromoBanner = React.forwardRef<HTMLElement, PromoBannerProps>(
  ({ title, description, primaryAction, secondaryAction, icon, style, ...rest }, ref) => {
    const sx = stylex.props(styles.banner);
    return (
      <section ref={ref} {...rest} className={sx.className} style={{ ...sx.style, ...style }}>
        <span aria-hidden="true" {...stylex.props(styles.dotOverlay)} />
        <div {...stylex.props(styles.iconTile)} aria-hidden="true">
          {icon ?? <Sparkles size={22} />}
        </div>
        <div {...stylex.props(styles.textCol)}>
          <p {...stylex.props(styles.title)}>{title}</p>
          {description ? <p {...stylex.props(styles.description)}>{description}</p> : null}
        </div>
        {(primaryAction || secondaryAction) && (
          <div {...stylex.props(styles.actions)}>
            {primaryAction ? (
              <Button size="sm" variant="default" onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            ) : null}
            {secondaryAction ? (
              <Button size="sm" variant="ghost" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            ) : null}
          </div>
        )}
      </section>
    );
  },
);
PromoBanner.displayName = "PromoBanner";
