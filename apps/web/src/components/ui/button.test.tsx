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

  it("propagates className to the asChild element (regression: ISH-302)", () => {
    // 以前は Button 内部で `inner` を Fragment で包んでおり、Radix Slot が
    // Fragment を cloneElement しても className が捨てられるためボタンの見た目が
    // 失われていた (= ただの link テキスト化)。className が <a> に届くこと。
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.className).toMatch(/\S/);
    // primary variant の background-color tokens が当たっている class を含む。
    expect(link.className).toMatch(/backgroundColor/);
  });

  it("renders leftIcon next to children when asChild is set (regression: ISH-302)", () => {
    render(
      <Button asChild leftIcon={<span data-testid="lead">+</span>}>
        <a href="/new">Create</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: /Create/ });
    expect(link).toBeInTheDocument();
    // leftIcon が <a> の中に入って一緒に rendering される。
    expect(link).toContainElement(screen.getByTestId("lead"));
    expect(link.textContent).toBe("+Create");
  });

  it("accepts variant and size props without crashing", () => {
    render(
      <Button variant="secondary" size="lg">
        Big
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Big" })).toBeInTheDocument();
  });

  it("renders leftIcon / rightIcon around the children", () => {
    render(
      <Button
        leftIcon={<span data-testid="left">L</span>}
        rightIcon={<span data-testid="right">R</span>}
      >
        Mid
      </Button>,
    );
    expect(screen.getByTestId("left")).toBeInTheDocument();
    expect(screen.getByTestId("right")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveTextContent("LMidR");
  });

  it("disables and marks aria-busy when loading", () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("does not invoke onClick when loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    screen.getByRole("button").click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
