import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, space, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  label: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    color: colors.fg,
    display: "block",
    marginBottom: space.xs,
  },
  required: {
    color: colors.destructive,
    marginLeft: space.xs,
  },
  helper: {
    display: "block",
    marginTop: space.xs,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    color: colors.muted,
  },
});

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Render an asterisk after the label text. */
  required?: boolean;
  /** Helper text shown below the label (in muted color). */
  helperText?: React.ReactNode;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ style, children, required = false, helperText, ...props }, ref) => {
    const labelSx = stylex.props(styles.label);
    const reqSx = stylex.props(styles.required);
    const helperSx = stylex.props(styles.helper);
    return (
      <>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is supplied by callers; this is a primitive wrapper. */}
        <label
          ref={ref}
          {...props}
          className={labelSx.className}
          style={{ ...labelSx.style, ...style }}
        >
          {children}
          {required && (
            <span aria-hidden="true" className={reqSx.className} style={reqSx.style}>
              *
            </span>
          )}
        </label>
        {helperText != null && (
          <span className={helperSx.className} style={helperSx.style}>
            {helperText}
          </span>
        )}
      </>
    );
  },
);
Label.displayName = "Label";
