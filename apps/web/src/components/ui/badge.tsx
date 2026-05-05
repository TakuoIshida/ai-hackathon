import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingInline: space.sm,
    paddingBlock: "0.125rem",
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
    borderRadius: radius.full,
    whiteSpace: "nowrap",
  },
  variantDefault: {
    backgroundColor: colors.accent,
    color: colors.accentFg,
  },
  variantPrimary: {
    backgroundColor: colors.primary,
    color: colors.primaryFg,
  },
  variantOutline: {
    backgroundColor: "transparent",
    color: colors.fg,
    border: `1px solid ${colors.border}`,
  },
  variantInfo: {
    backgroundColor: colors.info,
    color: colors.infoFg,
  },
  variantSuccess: {
    backgroundColor: colors.success,
    color: colors.successFg,
  },
  variantWarning: {
    backgroundColor: colors.warning,
    color: colors.warningFg,
  },
  variantDestructive: {
    backgroundColor: colors.destructive,
    color: colors.destructiveFg,
  },
});

const variantMap = {
  default: styles.variantDefault,
  primary: styles.variantPrimary,
  outline: styles.variantOutline,
  info: styles.variantInfo,
  success: styles.variantSuccess,
  warning: styles.variantWarning,
  destructive: styles.variantDestructive,
} as const;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variantMap;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ style, variant = "default", ...props }, ref) => {
    const sx = stylex.props(styles.base, variantMap[variant]);
    return <span ref={ref} {...props} className={sx.className} style={{ ...sx.style, ...style }} />;
  },
);
Badge.displayName = "Badge";
