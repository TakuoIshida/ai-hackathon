import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as stylex from "@stylexjs/stylex";
import { Check } from "lucide-react";
import * as React from "react";
import { colors, radius } from "@/styles/tokens.stylex";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1rem",
    height: "1rem",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${colors.ring}` },
  },
  checked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    color: colors.primaryFg,
  },
});

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ style, checked, ...props }, ref) => {
  const sx = stylex.props(styles.root, checked === true && styles.checked);
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      checked={checked}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    >
      <CheckboxPrimitive.Indicator>
        <Check size={12} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = "Checkbox";
