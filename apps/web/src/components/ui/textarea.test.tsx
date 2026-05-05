import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Textarea } from "./textarea";

describe("<Textarea />", () => {
  it("renders with placeholder and accepts input", () => {
    const onChange = vi.fn();
    render(<Textarea placeholder="message" onChange={onChange} />);
    const el = screen.getByPlaceholderText("message");
    expect(el).toBeInTheDocument();
    fireEvent.change(el, { target: { value: "hi" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("sets aria-invalid when error is true", () => {
    render(<Textarea placeholder="x" error />);
    expect(screen.getByPlaceholderText("x")).toHaveAttribute("aria-invalid", "true");
  });
});
