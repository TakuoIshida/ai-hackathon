import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    paddingInline: space.md,
    paddingBlock: space.sm,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
  },
  variantInfo: {
    backgroundColor: colors.bg,
    borderColor: colors.info,
    color: colors.fg,
  },
  variantSuccess: {
    backgroundColor: colors.bg,
    borderColor: colors.success,
    color: colors.fg,
  },
  variantWarning: {
    backgroundColor: colors.bg,
    borderColor: colors.warning,
    color: colors.fg,
  },
  variantDestructive: {
    backgroundColor: colors.bg,
    borderColor: colors.destructive,
    color: colors.fg,
  },
  title: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightSemibold,
    margin: 0,
  },
  description: {
    fontSize: typography.fontSizeSm,
    color: colors.muted,
    margin: 0,
  },
});

const variantMap = {
  info: styles.variantInfo,
  success: styles.variantSuccess,
  warning: styles.variantWarning,
  destructive: styles.variantDestructive,
} as const;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variantMap;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ style, variant = "info", ...props }, ref) => {
    const sx = stylex.props(styles.base, variantMap[variant]);
    return (
      <div
        ref={ref}
        role="alert"
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      />
    );
  },
);
Alert.displayName = "Alert";

export function AlertTitle({ children }: { children: React.ReactNode }) {
  return <h5 {...stylex.props(styles.title)}>{children}</h5>;
}

export function AlertDescription({ children }: { children: React.ReactNode }) {
  return <p {...stylex.props(styles.description)}>{children}</p>;
}
