import { Slot } from "@radix-ui/react-slot";
import * as stylex from "@stylexjs/stylex";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const spinKeyframes = stylex.keyframes({
  from: { transform: "rotate(0deg)" },
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  base: {
    position: "relative",
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
  variantPrimary: {
    backgroundColor: { default: colors.primary, ":hover": "#2a2a2a" },
    color: colors.primaryFg,
  },
  variantSecondary: {
    backgroundColor: { default: colors.accent, ":hover": "#e5e5e5" },
    color: colors.accentFg,
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
  sizeSm: {
    height: "2.25rem",
    paddingInline: space.sm,
    fontSize: typography.fontSizeXs,
  },
  sizeMd: {
    height: "2.5rem",
    paddingInline: space.md,
  },
  sizeLg: {
    height: "2.75rem",
    paddingInline: space.lg,
    fontSize: typography.fontSizeMd,
  },
  sizeIcon: {
    height: "2.5rem",
    width: "2.5rem",
    paddingInline: 0,
  },
  // loading state — hide children to keep width stable, overlay spinner
  loadingChildren: {
    visibility: "hidden",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    animationName: spinKeyframes,
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
});

const variantMap = {
  primary: styles.variantPrimary,
  // alias kept for backward compat with existing call sites that used `default`
  default: styles.variantPrimary,
  secondary: styles.variantSecondary,
  outline: styles.variantOutline,
  ghost: styles.variantGhost,
  destructive: styles.variantDestructive,
} as const;

const sizeMap = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  // alias kept for backward compat
  default: styles.sizeMd,
  lg: styles.sizeLg,
  icon: styles.sizeIcon,
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantMap;
  size?: keyof typeof sizeMap;
  asChild?: boolean;
  /** Show a spinner and disable the button. */
  loading?: boolean;
  /** Element rendered before children (hidden while loading). */
  leftIcon?: React.ReactNode;
  /** Element rendered after children (hidden while loading). */
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      asChild = false,
      style,
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const sx = stylex.props(styles.base, variantMap[variant], sizeMap[size]);
    const childrenSx = stylex.props(loading && styles.loadingChildren);
    const overlaySx = stylex.props(styles.loadingOverlay);
    const spinnerSx = stylex.props(styles.spinner);

    const inner = (
      <>
        {leftIcon}
        {children}
        {rightIcon}
      </>
    );

    return (
      <Comp
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      >
        {loading ? (
          <>
            <span className={childrenSx.className} style={childrenSx.style}>
              {inner}
            </span>
            <span className={overlaySx.className} style={overlaySx.style}>
              <Loader2 size={16} className={spinnerSx.className} style={spinnerSx.style} />
            </span>
          </>
        ) : (
          inner
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
