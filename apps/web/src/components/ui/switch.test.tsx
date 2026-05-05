import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch";

describe("<Switch />", () => {
  it("renders an unchecked switch by default", () => {
    render(<Switch aria-label="toggle" />);
    const el = screen.getByRole("switch", { name: "toggle" });
    expect(el).toBeInTheDocument();
    expect(el).not.toBeChecked();
  });

  it("can be controlled with the checked prop", () => {
    render(<Switch aria-label="toggle" checked />);
    expect(screen.getByRole("switch", { name: "toggle" })).toBeChecked();
  });
});
