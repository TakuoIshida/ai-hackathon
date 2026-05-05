import * as ToastPrimitive from "@radix-ui/react-toast";
import * as stylex from "@stylexjs/stylex";
import { CheckCircle2, X, XCircle } from "lucide-react";
import * as React from "react";
import { colors, radius, shadow, space, typography, zIndex } from "@/styles/tokens.stylex";

/**
 * Toast notification system (Radix Toast wrapper).
 *
 * Mount `<ToastProvider>` once at the app root. Then call `useToast()` from
 * any component to fire a notification:
 *
 *   const { toast } = useToast();
 *   toast({ title: "Saved", variant: "success" });
 *
 * Variants: default / success / destructive.
 */

type ToastVariant = "default" | "success" | "destructive";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss duration in ms. Default: 4000. 0 = no auto-dismiss. */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const styles = stylex.create({
  viewport: {
    position: "fixed",
    bottom: space.lg,
    right: space.lg,
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
    width: "min(24rem, calc(100vw - 2rem))",
    margin: 0,
    padding: 0,
    listStyle: "none",
    zIndex: zIndex.toast,
    outline: "none",
  },
  root: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    alignItems: "start",
    gap: space.sm,
    paddingInline: space.md,
    paddingBlock: space.sm,
    backgroundColor: colors.bg,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    boxShadow: shadow.md,
  },
  rootSuccess: {
    borderColor: colors.success,
  },
  rootDestructive: {
    borderColor: colors.destructive,
  },
  iconColumn: {
    display: "inline-flex",
    alignItems: "center",
    paddingTop: "2px",
  },
  iconSuccess: {
    color: colors.success,
  },
  iconDestructive: {
    color: colors.destructive,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
    minWidth: 0,
  },
  title: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightSemibold,
    color: colors.fg,
    margin: 0,
  },
  description: {
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeXs,
    color: colors.muted,
    margin: 0,
  },
  closeButton: {
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

const variantRootMap: Record<ToastVariant, ReturnType<typeof stylex.props> | null> = {
  default: null,
  success: stylex.props(styles.rootSuccess),
  destructive: stylex.props(styles.rootDestructive),
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "success") {
    const sx = stylex.props(styles.iconColumn, styles.iconSuccess);
    return (
      <span className={sx.className} style={sx.style}>
        <CheckCircle2 size={18} />
      </span>
    );
  }
  if (variant === "destructive") {
    const sx = stylex.props(styles.iconColumn, styles.iconDestructive);
    return (
      <span className={sx.className} style={sx.style}>
        <XCircle size={18} />
      </span>
    );
  }
  return null;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<ToastEntry[]>([]);
  const idRef = React.useRef(0);

  const toast = React.useCallback((options: ToastOptions) => {
    const id = ++idRef.current;
    setEntries((prev) => [...prev, { id, variant: "default", duration: 4000, ...options }]);
  }, []);

  const remove = React.useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const value = React.useMemo<ToastContextValue>(() => ({ toast }), [toast]);
  const viewportSx = stylex.props(styles.viewport);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {entries.map((entry) => (
          <ToastItem
            key={entry.id}
            entry={entry}
            onOpenChange={(open) => {
              if (!open) remove(entry.id);
            }}
          />
        ))}
        <ToastPrimitive.Viewport className={viewportSx.className} style={viewportSx.style} />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  entry: ToastEntry;
  onOpenChange: (open: boolean) => void;
}

function ToastItem({ entry, onOpenChange }: ToastItemProps) {
  const variant = entry.variant ?? "default";
  const variantSx = variantRootMap[variant];
  const baseSx = stylex.props(styles.root);
  const titleSx = stylex.props(styles.title);
  const descSx = stylex.props(styles.description);
  const closeSx = stylex.props(styles.closeButton);

  const className = [baseSx.className, variantSx?.className].filter(Boolean).join(" ");
  const mergedStyle = { ...baseSx.style, ...(variantSx?.style ?? {}) };

  return (
    <ToastPrimitive.Root
      duration={entry.duration}
      onOpenChange={onOpenChange}
      className={className}
      style={mergedStyle}
    >
      <ToastIcon variant={variant} />
      <span className={stylex.props(styles.body).className} style={stylex.props(styles.body).style}>
        <ToastPrimitive.Title className={titleSx.className} style={titleSx.style}>
          {entry.title}
        </ToastPrimitive.Title>
        {entry.description != null && (
          <ToastPrimitive.Description className={descSx.className} style={descSx.style}>
            {entry.description}
          </ToastPrimitive.Description>
        )}
      </span>
      <ToastPrimitive.Close aria-label="Close" className={closeSx.className} style={closeSx.style}>
        <X size={14} />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be called inside <ToastProvider>");
  }
  return ctx;
}
