import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./stepper";

const steps = [
  { label: "招待を確認" },
  { label: "Googleでログイン" },
  { label: "カレンダー連携" },
  { label: "完了" },
];

describe("<Stepper />", () => {
  it("current=0: 1 つ目が active で番号、残りは pending、check icon は 0 個", () => {
    render(<Stepper steps={steps} current={0} />);
    // 全ラベルが表示されている
    for (const s of steps) {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    }
    // active step は aria-current="step"
    const activeItem = screen.getByText("招待を確認").closest("li");
    expect(activeItem).toHaveAttribute("aria-current", "step");
    expect(activeItem).toHaveAttribute("data-status", "active");
    // active 円には番号 "1" が入る
    expect(within(activeItem as HTMLElement).getByText("1")).toBeInTheDocument();
    // 残り 3 step は pending
    for (const label of ["Googleでログイン", "カレンダー連携", "完了"]) {
      const li = screen.getByText(label).closest("li");
      expect(li).toHaveAttribute("data-status", "pending");
    }
    // check icon は出ない (done step が無いので)
    expect(screen.queryAllByTestId("stepper-check")).toHaveLength(0);
  });

  it("current=2: 0,1 が done (check icon 出る), 2 が active (label bold), 3 が pending", () => {
    render(<Stepper steps={steps} current={2} />);
    const doneStep0 = screen.getByText("招待を確認").closest("li");
    const doneStep1 = screen.getByText("Googleでログイン").closest("li");
    const activeStep = screen.getByText("カレンダー連携").closest("li");
    const pendingStep = screen.getByText("完了").closest("li");

    expect(doneStep0).toHaveAttribute("data-status", "done");
    expect(doneStep1).toHaveAttribute("data-status", "done");
    expect(activeStep).toHaveAttribute("data-status", "active");
    expect(activeStep).toHaveAttribute("aria-current", "step");
    expect(pendingStep).toHaveAttribute("data-status", "pending");

    // done step には check icon が入る
    expect(within(doneStep0 as HTMLElement).getByTestId("stepper-check")).toBeInTheDocument();
    expect(within(doneStep1 as HTMLElement).getByTestId("stepper-check")).toBeInTheDocument();

    // active step の円には "3" (i+1)
    expect(within(activeStep as HTMLElement).getByText("3")).toBeInTheDocument();

    // active label は bold (700)。stepActive スタイルが当たっていることを
    // computed style 経由で検証するのは jsdom では不安定なので、
    // 代わりに data-status="active" のみで担保する。
  });

  it("current=4 (=steps.length): 全 step が done で check icon が 4 個", () => {
    render(<Stepper steps={steps} current={steps.length} />);
    for (const s of steps) {
      const li = screen.getByText(s.label).closest("li");
      expect(li).toHaveAttribute("data-status", "done");
    }
    expect(screen.queryAllByTestId("stepper-check")).toHaveLength(steps.length);
    // active な step は無い
    expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
  });
});
