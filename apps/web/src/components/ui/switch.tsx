import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius } from "@/styles/tokens.stylex";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    width: "2.25rem",
    height: "1.25rem",
    paddingInline: "2px",
    backgroundColor: colors.border,
    borderRadius: radius.full,
    border: "none",
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${colors.ring}` },
  },
  checked: {
    backgroundColor: colors.primary,
  },
  thumb: {
    display: "block",
    width: "1rem",
    height: "1rem",
    backgroundColor: colors.bg,
    borderRadius: radius.full,
    transitionProperty: "transform",
    transitionDuration: "120ms",
    transform: "translateX(0)",
  },
  thumbChecked: {
    transform: "translateX(1rem)",
  },
});

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ style, checked, ...props }, ref) => {
  const sx = stylex.props(styles.root, checked === true && styles.checked);
  const thumbSx = stylex.props(styles.thumb, checked === true && styles.thumbChecked);
  return (
    <SwitchPrimitive.Root
      ref={ref}
      checked={checked}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    >
      <SwitchPrimitive.Thumb className={thumbSx.className} style={thumbSx.style} />
    </SwitchPrimitive.Root>
  );
});
Switch.displayName = "Switch";
