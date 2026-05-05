import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1rem",
    height: "1rem",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.full,
    backgroundColor: colors.bg,
    cursor: "pointer",
    outline: "none",
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${colors.ring}` },
  },
  indicator: {
    display: "inline-block",
    width: "0.5rem",
    height: "0.5rem",
    backgroundColor: colors.primary,
    borderRadius: radius.full,
  },
});

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.root);
  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
RadioGroup.displayName = "RadioGroup";

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.item);
  const indicatorSx = stylex.props(styles.indicator);
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    >
      <RadioGroupPrimitive.Indicator className={indicatorSx.className} style={indicatorSx.style} />
    </RadioGroupPrimitive.Item>
  );
});
RadioGroupItem.displayName = "RadioGroupItem";
