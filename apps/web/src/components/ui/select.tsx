import * as SelectPrimitive from "@radix-ui/react-select";
import * as stylex from "@stylexjs/stylex";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { colors, radius, shadow, space, typography, zIndex } from "@/styles/tokens.stylex";

/**
 * Select (Radix Select wrapper).
 *
 * 例:
 *
 *   <Select value={v} onValueChange={setV}>
 *     <SelectTrigger>
 *       <SelectValue placeholder="選択..." />
 *     </SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="a">A</SelectItem>
 *       <SelectItem value="b">B</SelectItem>
 *     </SelectContent>
 *   </Select>
 */

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    height: "2.5rem",
    paddingInline: space.md,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    color: colors.fg,
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    cursor: "pointer",
    outline: "none",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "120ms",
    borderColor: { default: colors.border, ":focus": colors.ring },
    boxShadow: { default: "none", ":focus": `0 0 0 2px ${colors.ring}` },
  },
  content: {
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    boxShadow: shadow.md,
    padding: space.xs,
    zIndex: zIndex.dropdown,
    minWidth: "8rem",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInline: space.sm,
    paddingBlock: space.xs,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    color: colors.fg,
    backgroundColor: { default: "transparent", ":hover": colors.accent },
    borderRadius: radius.sm,
    cursor: "pointer",
    outline: "none",
    userSelect: "none",
  },
  indicator: {
    display: "inline-flex",
    width: "1rem",
    justifyContent: "center",
  },
});

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export const SelectGroup = SelectPrimitive.Group;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ style, children, ...props }, ref) => {
  const sx = stylex.props(styles.trigger);
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown size={16} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ style, children, position = "popper", ...props }, ref) => {
  const sx = stylex.props(styles.content);
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ style, children, ...props }, ref) => {
  const sx = stylex.props(styles.item);
  const indicatorSx = stylex.props(styles.indicator);
  return (
    <SelectPrimitive.Item
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    >
      <SelectPrimitive.ItemIndicator className={indicatorSx.className} style={indicatorSx.style}>
        <Check size={14} />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = "SelectItem";
