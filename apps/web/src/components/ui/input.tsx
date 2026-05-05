import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  wrapper: {
    display: "inline-flex",
    alignItems: "stretch",
    width: "100%",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    overflow: "hidden",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "120ms",
  },
  wrapperFocused: {
    borderColor: colors.ring,
    boxShadow: `0 0 0 2px ${colors.ring}`,
  },
  wrapperError: {
    borderColor: colors.destructive,
    boxShadow: `0 0 0 2px ${colors.destructive}`,
  },
  input: {
    flex: "1 1 auto",
    minWidth: 0,
    paddingInline: space.md,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    backgroundColor: "transparent",
    color: colors.fg,
    border: "none",
    outline: "none",
    width: "100%",
  },
  sizeSm: {
    height: "2.25rem",
    fontSize: typography.fontSizeXs,
  },
  sizeMd: {
    height: "2.5rem",
  },
  sizeLg: {
    height: "2.75rem",
  },
  addon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    paddingInline: space.sm,
    color: colors.muted,
    fontSize: typography.fontSizeSm,
    backgroundColor: colors.accent,
    flex: "0 0 auto",
  },
});

const sizeMap = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
} as const;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Error state — red border + ring. */
  error?: boolean;
  /** Visual size. Default: md. */
  size?: keyof typeof sizeMap;
  /** Element rendered before the input (inside the bordered wrapper). */
  leftAddon?: React.ReactNode;
  /** Element rendered after the input (inside the bordered wrapper). */
  rightAddon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ style, error = false, size = "md", leftAddon, rightAddon, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const wrapperSx = stylex.props(
      styles.wrapper,
      focused && !error && styles.wrapperFocused,
      error && styles.wrapperError,
    );
    const inputSx = stylex.props(styles.input, sizeMap[size]);
    const addonSx = stylex.props(styles.addon, sizeMap[size]);

    return (
      <span className={wrapperSx.className} style={wrapperSx.style}>
        {leftAddon != null && (
          <span className={addonSx.className} style={addonSx.style}>
            {leftAddon}
          </span>
        )}
        <input
          ref={ref}
          aria-invalid={error || undefined}
          {...props}
          className={inputSx.className}
          style={{ ...inputSx.style, ...style }}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
        />
        {rightAddon != null && (
          <span className={addonSx.className} style={addonSx.style}>
            {rightAddon}
          </span>
        )}
      </span>
    );
  },
);
Input.displayName = "Input";
