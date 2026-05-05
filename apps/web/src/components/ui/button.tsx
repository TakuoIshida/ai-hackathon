import { Slot } from "@radix-ui/react-slot";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    whiteSpace: "nowrap",
    borderRadius: radius.md,
    border: "1px solid transparent",
    fontFamily: typography.fontFamilySans,
    fontWeight: typography.fontWeightMedium,
    fontSize: typography.fontSizeSm,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.5 },
    transitionProperty: "background-color, color, border-color, opacity",
    transitionDuration: "120ms",
    outline: "none",
  },
  // variants
  variantDefault: {
    backgroundColor: { default: colors.primary, ":hover": "#2a2a2a" },
    color: colors.primaryFg,
  },
  variantOutline: {
    backgroundColor: { default: colors.bg, ":hover": colors.accent },
    color: colors.fg,
    borderColor: colors.border,
  },
  variantGhost: {
    backgroundColor: { default: "transparent", ":hover": colors.accent },
    color: colors.fg,
  },
  variantDestructive: {
    backgroundColor: { default: colors.destructive, ":hover": "#b91c1c" },
    color: colors.destructiveFg,
  },
  // sizes
  sizeDefault: {
    height: "2.5rem",
    paddingInline: space.md,
  },
  sizeSm: {
    height: "2.25rem",
    paddingInline: space.sm,
    fontSize: typography.fontSizeXs,
  },
  sizeLg: {
    height: "2.75rem",
    paddingInline: space.lg,
  },
  sizeIcon: {
    height: "2.5rem",
    width: "2.5rem",
    paddingInline: 0,
  },
});

const variantMap = {
  default: styles.variantDefault,
  outline: styles.variantOutline,
  ghost: styles.variantGhost,
  destructive: styles.variantDestructive,
} as const;

const sizeMap = {
  default: styles.sizeDefault,
  sm: styles.sizeSm,
  lg: styles.sizeLg,
  icon: styles.sizeIcon,
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantMap;
  size?: keyof typeof sizeMap;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "default", asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const sx = stylex.props(styles.base, variantMap[variant], sizeMap[size]);
    return <Comp ref={ref} {...props} className={sx.className} style={{ ...sx.style, ...style }} />;
  },
);
Button.displayName = "Button";
