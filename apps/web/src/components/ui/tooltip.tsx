import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, shadow, space, typography, zIndex } from "@/styles/tokens.stylex";

/**
 * Tooltip (Radix Tooltip wrapper).
 *
 * 例:
 *
 *   <TooltipProvider>
 *     <Tooltip>
 *       <TooltipTrigger asChild>
 *         <Button>Hover me</Button>
 *       </TooltipTrigger>
 *       <TooltipContent>Tooltip text</TooltipContent>
 *     </Tooltip>
 *   </TooltipProvider>
 *
 * `TooltipProvider` を root に一度 mount すれば配下の Tooltip 全部に効く。
 */

const styles = stylex.create({
  content: {
    paddingInline: space.sm,
    paddingBlock: space.xs,
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    color: colors.bg,
    backgroundColor: colors.fg,
    borderRadius: radius.sm,
    boxShadow: shadow.sm,
    zIndex: zIndex.overlay,
    maxWidth: "20rem",
  },
});

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ style, sideOffset = 4, ...props }, ref) => {
  const sx = stylex.props(styles.content);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        {...props}
        className={sx.className}
        style={{ ...sx.style, ...style }}
      />
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = "TooltipContent";
