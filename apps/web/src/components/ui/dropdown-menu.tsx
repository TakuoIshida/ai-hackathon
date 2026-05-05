import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, shadow, space, typography, zIndex } from "@/styles/tokens.stylex";

/**
 * DropdownMenu (Radix DropdownMenu wrapper).
 *
 * 例:
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild>
 *       <Button>Open menu</Button>
 *     </DropdownMenuTrigger>
 *     <DropdownMenuContent>
 *       <DropdownMenuItem onSelect={...}>Edit</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem onSelect={...}>Delete</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */

const styles = stylex.create({
  content: {
    minWidth: "12rem",
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    boxShadow: shadow.md,
    padding: space.xs,
    zIndex: zIndex.dropdown,
    display: "flex",
    flexDirection: "column",
    gap: 0,
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
  itemDanger: {
    color: colors.destructive,
  },
  separator: {
    height: "1px",
    backgroundColor: colors.border,
    marginBlock: space.xs,
    marginInline: 0,
    border: "none",
  },
  label: {
    paddingInline: space.sm,
    paddingBlock: space.xs,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
});

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ style, sideOffset = 4, ...props }, ref) => {
  const sx = stylex.props(styles.content);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    /** Apply destructive (red) styling. */
    variant?: "default" | "danger";
  }
>(({ style, variant = "default", ...props }, ref) => {
  const sx = stylex.props(styles.item, variant === "danger" && styles.itemDanger);
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.separator);
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.label);
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
DropdownMenuLabel.displayName = "DropdownMenuLabel";
