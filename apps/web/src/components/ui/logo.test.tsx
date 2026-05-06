import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./logo";

describe("<Logo />", () => {
  it("renders with default size (md)", () => {
    render(<Logo />);
    const logo = screen.getByTestId("logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("data-size", "md");
    expect(logo).toHaveAttribute("aria-label", "Rips");
    // md → 26px, dot diameter = 26 * 0.34 ≈ 8.84px
    expect(logo.style.fontSize).toBe("26px");
    const dot = screen.getByTestId("logo-dot");
    expect(dot.style.width).toBe(`${26 * 0.34}px`);
    expect(dot.style.height).toBe(`${26 * 0.34}px`);
  });

  it("renders with size=sm", () => {
    render(<Logo size="sm" />);
    const logo = screen.getByTestId("logo");
    expect(logo.style.fontSize).toBe("18px");
    const dot = screen.getByTestId("logo-dot");
    expect(dot.style.width).toBe(`${18 * 0.34}px`);
    expect(dot.style.height).toBe(`${18 * 0.34}px`);
  });

  it("renders with size=lg", () => {
    render(<Logo size="lg" />);
    const logo = screen.getByTestId("logo");
    expect(logo.style.fontSize).toBe("32px");
    const dot = screen.getByTestId("logo-dot");
    expect(dot.style.width).toBe(`${32 * 0.34}px`);
    expect(dot.style.height).toBe(`${32 * 0.34}px`);
  });

  it("renders R, i, ps text content", () => {
    render(<Logo />);
    const logo = screen.getByTestId("logo");
    // Rendered as separate spans (R, i, ps) but textContent concatenates them.
    expect(logo.textContent).toBe("Rips");
  });
});
