import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  base: {
    width: "100%",
    minHeight: "5rem",
    paddingInline: space.md,
    paddingBlock: space.sm,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    lineHeight: typography.lineHeightNormal,
    color: colors.fg,
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    outline: "none",
    resize: "vertical",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "120ms",
    borderColor: { default: colors.border, ":focus": colors.ring },
    boxShadow: { default: "none", ":focus": `0 0 0 2px ${colors.ring}` },
  },
  error: {
    borderColor: colors.destructive,
    boxShadow: `0 0 0 2px ${colors.destructive}`,
  },
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Error state — red border + ring. */
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ style, error = false, ...props }, ref) => {
    const sx = stylex.props(styles.base, error && styles.error);
    return (
      <textarea
        ref={ref}
        aria-invalid={error || undefined}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      />
    );
  },
);
Textarea.displayName = "Textarea";
