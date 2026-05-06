import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, typography } from "@/styles/tokens.stylex";

/**
 * Stepper — 横並び 4-step (or n-step) のオンボーディング進捗インジケータ。
 *
 * Spir デザイン (welcome.jsx / setup-complete.jsx) を参考に実装。
 * 各 step は 22×22 円 (番号 or check icon) + ラベル、step 間に 16px の
 * 1px connector line を挟む。状態 (done / active / pending) で円・connector
 * の色が切り替わる。
 *
 * - i < current → done   : mint500 円 + check icon, connector mint500
 * - i === current → active: blue600 円 + 番号, label blue700 bold
 * - i > current → pending : ink100 円 + 番号 (ink500), label ink400, connector ink200
 */

const styles = stylex.create({
  root: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontFamily: typography.fontFamilySans,
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
    fontSize: "0.6875rem", // 11px
    fontWeight: typography.fontWeightBold,
  },
  stepDone: {
    color: colors.mint500,
  },
  stepActive: {
    color: colors.blue700,
  },
  stepPending: {
    color: colors.ink400,
  },
  circle: {
    width: "1.375rem", // 22px
    height: "1.375rem",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontSize: "0.6875rem",
    flexShrink: 0,
    lineHeight: 1,
  },
  circleDone: {
    backgroundColor: colors.mint500,
    color: "#ffffff",
  },
  circleActive: {
    backgroundColor: colors.blue600,
    color: "#ffffff",
  },
  circlePending: {
    backgroundColor: colors.ink100,
    color: colors.ink500,
  },
  connector: {
    flex: "0 0 1rem", // 16px
    height: "1px",
  },
  connectorDone: {
    backgroundColor: colors.mint500,
  },
  connectorPending: {
    backgroundColor: colors.ink200,
  },
});

type StepStatus = "done" | "active" | "pending";

function statusOf(index: number, current: number): StepStatus {
  if (index < current) return "done";
  if (index === current) return "active";
  return "pending";
}

export interface StepperProps extends React.HTMLAttributes<HTMLOListElement> {
  steps: ReadonlyArray<{ label: string }>;
  /** 0-indexed current step。`steps.length` を渡すと全 done になる。 */
  current: number;
}

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="stepper-check"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export const Stepper = React.forwardRef<HTMLOListElement, StepperProps>(
  ({ steps, current, style, ...props }, ref) => {
    const rootSx = stylex.props(styles.root);
    return (
      <ol
        ref={ref}
        aria-label="progress"
        {...props}
        className={[rootSx.className, props.className].filter(Boolean).join(" ") || undefined}
        style={{ ...rootSx.style, ...style, listStyle: "none", margin: 0, padding: 0 }}
      >
        {steps.map((s, i) => {
          const status = statusOf(i, current);
          const stepStyle =
            status === "done"
              ? styles.stepDone
              : status === "active"
                ? styles.stepActive
                : styles.stepPending;
          const circleStyle =
            status === "done"
              ? styles.circleDone
              : status === "active"
                ? styles.circleActive
                : styles.circlePending;
          const isLast = i === steps.length - 1;
          // connector: i 番目 step の後ろにある区切り線。i < current なら
          // 「current より前 (= done) を抜けた」線として mint。それ以外は ink200。
          const connectorStyle = i < current ? styles.connectorDone : styles.connectorPending;
          return (
            <React.Fragment key={s.label}>
              <li
                {...stylex.props(styles.step, stepStyle)}
                aria-current={status === "active" ? "step" : undefined}
                data-status={status}
              >
                <span {...stylex.props(styles.circle, circleStyle)} aria-hidden="true">
                  {status === "done" ? <CheckIcon size={12} /> : i + 1}
                </span>
                <span>{s.label}</span>
              </li>
              {!isLast && (
                <span
                  {...stylex.props(styles.connector, connectorStyle)}
                  aria-hidden="true"
                  data-testid="stepper-connector"
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    );
  },
);
Stepper.displayName = "Stepper";
