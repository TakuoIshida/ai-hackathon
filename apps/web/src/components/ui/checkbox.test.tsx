import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";

describe("<Checkbox />", () => {
  it("renders an unchecked checkbox by default", () => {
    render(<Checkbox aria-label="agree" />);
    const el = screen.getByRole("checkbox", { name: "agree" });
    expect(el).toBeInTheDocument();
    expect(el).not.toBeChecked();
  });

  it("can be controlled with the checked prop", () => {
    render(<Checkbox aria-label="agree" checked />);
    expect(screen.getByRole("checkbox", { name: "agree" })).toBeChecked();
  });
});
