import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import * as React from "react";
import { colors, radius, shadow, space, typography, zIndex } from "@/styles/tokens.stylex";

/**
 * Modal Dialog (Radix Dialog wrapper).
 *
 * 例:
 *
 *   <Dialog>
 *     <DialogTrigger asChild>
 *       <Button>Open</Button>
 *     </DialogTrigger>
 *     <DialogContent>
 *       <DialogTitle>Title</DialogTitle>
 *       <DialogDescription>...</DialogDescription>
 *       <DialogFooter>
 *         <DialogClose asChild>
 *           <Button variant="outline">Cancel</Button>
 *         </DialogClose>
 *       </DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 */

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    zIndex: zIndex.overlay,
  },
  content: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    boxShadow: shadow.lg,
    padding: space.lg,
    width: "100%",
    maxWidth: "32rem",
    maxHeight: "85vh",
    overflowY: "auto",
    zIndex: zIndex.modal,
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  title: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightTight,
    color: colors.fg,
    margin: 0,
  },
  description: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    color: colors.muted,
    margin: 0,
  },
  footer: {
    display: "flex",
    gap: space.sm,
    justifyContent: "flex-end",
    marginTop: space.md,
  },
  closeButton: {
    position: "absolute",
    top: space.md,
    right: space.md,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.5rem",
    height: "1.5rem",
    borderRadius: radius.sm,
    border: "none",
    backgroundColor: { default: "transparent", ":hover": colors.accent },
    color: colors.muted,
    cursor: "pointer",
    outline: "none",
  },
});

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Hide the built-in close button (X). Default: false */
    hideCloseButton?: boolean;
  }
>(({ children, style, hideCloseButton = false, ...props }, ref) => {
  const overlaySx = stylex.props(styles.overlay);
  const contentSx = stylex.props(styles.content);
  const closeSx = stylex.props(styles.closeButton);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlaySx.className} style={overlaySx.style} />
      <DialogPrimitive.Content
        ref={ref}
        {...props}
        className={contentSx.className}
        style={{ ...contentSx.style, ...style }}
      >
        {children}
        {!hideCloseButton && (
          <DialogPrimitive.Close
            aria-label="Close"
            className={closeSx.className}
            style={closeSx.style}
          >
            <X size={16} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = "DialogContent";

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.title);
  return (
    <DialogPrimitive.Title
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ style, ...props }, ref) => {
  const sx = stylex.props(styles.description);
  return (
    <DialogPrimitive.Description
      ref={ref}
      {...props}
      className={sx.className}
      style={{ ...sx.style, ...style }}
    />
  );
});
DialogDescription.displayName = "DialogDescription";

export function DialogFooter({ children, style }: React.HTMLAttributes<HTMLDivElement>) {
  const sx = stylex.props(styles.footer);
  return (
    <div className={sx.className} style={{ ...sx.style, ...style }}>
      {children}
    </div>
  );
}
