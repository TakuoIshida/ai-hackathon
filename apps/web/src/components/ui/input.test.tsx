import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./input";

describe("<Input />", () => {
  it("renders an input element with the given placeholder", () => {
    render(<Input placeholder="メールアドレス" />);
    expect(screen.getByPlaceholderText("メールアドレス")).toBeInTheDocument();
  });

  it("calls onChange when the user types", () => {
    const onChange = vi.fn();
    render(<Input placeholder="x" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText("x"), { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("supports the disabled prop", () => {
    render(<Input disabled placeholder="x" />);
    expect(screen.getByPlaceholderText("x")).toBeDisabled();
  });

  it("sets aria-invalid when error is true", () => {
    render(<Input placeholder="x" error />);
    expect(screen.getByPlaceholderText("x")).toHaveAttribute("aria-invalid", "true");
  });

  it("renders leftAddon and rightAddon", () => {
    render(
      <Input
        placeholder="amount"
        leftAddon={<span data-testid="left">¥</span>}
        rightAddon={<span data-testid="right">.00</span>}
      />,
    );
    expect(screen.getByTestId("left")).toBeInTheDocument();
    expect(screen.getByTestId("right")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("amount")).toBeInTheDocument();
  });
});
