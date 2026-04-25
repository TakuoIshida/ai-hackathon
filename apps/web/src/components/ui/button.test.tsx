import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("<Button />", () => {
  it("renders children inside a button element", () => {
    render(<Button>Click me</Button>);

    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("invokes onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);

    screen.getByRole("button", { name: "Send" }).click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders as the asChild element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/somewhere">Go</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/somewhere");
  });
});
