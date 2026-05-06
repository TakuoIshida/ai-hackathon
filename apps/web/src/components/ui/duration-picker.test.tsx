import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DurationPicker } from "./duration-picker";

function Controlled({ initial = 30 }: { initial?: number }) {
  const [v, setV] = useState(initial);
  return <DurationPicker value={v} onChange={setV} aria-label="duration" />;
}

describe("<DurationPicker />", () => {
  it("renders the default 4 choices and marks the current one as checked", () => {
    render(<Controlled />);
    expect(screen.getByRole("radiogroup", { name: "duration" })).toBeInTheDocument();
    for (const m of [15, 30, 45, 60]) {
      expect(screen.getByRole("radio", { name: `${m}分` })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "30分" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "45分" })).toHaveAttribute("aria-checked", "false");
  });

  it("invokes onChange when a different chip is clicked", () => {
    render(<Controlled />);
    fireEvent.click(screen.getByRole("radio", { name: "45分" }));
    expect(screen.getByRole("radio", { name: "45分" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "30分" })).toHaveAttribute("aria-checked", "false");
  });

  it("respects the `choices` prop", () => {
    function Custom() {
      const [v, setV] = useState(20);
      return <DurationPicker value={v} onChange={setV} choices={[10, 20, 40, 80]} aria-label="d" />;
    }
    render(<Custom />);
    expect(screen.getByRole("radio", { name: "10分" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "80分" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "20分" })).toHaveAttribute("aria-checked", "true");
  });
});
