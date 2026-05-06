import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { value: "calendar", label: "カレンダーで選択" },
  { value: "form", label: "曜日×時間帯" },
] as const;

function Controlled({ initial = "calendar" }: { initial?: "calendar" | "form" }) {
  const [v, setV] = useState<"calendar" | "form">(initial);
  return <SegmentedControl value={v} onChange={setV} options={OPTIONS} aria-label="mode" />;
}

describe("<SegmentedControl />", () => {
  it("renders a radiogroup with the provided options", () => {
    render(<Controlled />);
    const group = screen.getByRole("radiogroup", { name: "mode" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /カレンダーで選択/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /曜日×時間帯/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("invokes onChange and switches the active item on click", () => {
    render(<Controlled />);
    fireEvent.click(screen.getByRole("radio", { name: /曜日×時間帯/ }));
    expect(screen.getByRole("radio", { name: /曜日×時間帯/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /カレンダーで選択/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("supports ArrowRight to move selection (radio semantics)", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="calendar" onChange={onChange} options={OPTIONS} aria-label="mode" />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: /カレンダーで選択/ }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("form");
  });
});
