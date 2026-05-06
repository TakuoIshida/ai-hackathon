import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { EmailChipsInput } from "./email-chips-input";

/**
 * Controlled wrapper — every onChange feeds back into value, so the component
 * behaves as it would in a real form.
 */
function Harness({
  initial = [],
  onChangeSpy,
}: {
  initial?: string[];
  onChangeSpy?: (next: string[]) => void;
}) {
  const [value, setValue] = React.useState<string[]>(initial);
  return (
    <EmailChipsInput
      aria-label="emails"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

const getInput = () => screen.getByLabelText("emails") as HTMLInputElement;

describe("<EmailChipsInput />", () => {
  it("renders each existing email as a chip", () => {
    render(<Harness initial={["a@x.com", "b@x.com"]} />);
    const chips = screen.getAllByTestId("email-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("a@x.com");
    expect(chips[1]).toHaveTextContent("b@x.com");
  });

  it("commits a chip on Enter", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith(["alice@example.com"]);
    expect(input.value).toBe("");
  });

  it("commits a chip when typing a comma separator", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    // Simulate typing email then a comma in one update — the change handler
    // splits on the separator and pushes the completed token.
    fireEvent.change(input, { target: { value: "alice@example.com," } });
    expect(spy).toHaveBeenLastCalledWith(["alice@example.com"]);
    expect(input.value).toBe("");
  });

  it("commits a chip on Space when draft is non-empty", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: " " });
    expect(spy).toHaveBeenLastCalledWith(["alice@example.com"]);
  });

  it("commits a chip on semicolon", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: ";" });
    expect(spy).toHaveBeenLastCalledWith(["alice@example.com"]);
  });

  it("paste with separators bulk-adds multiple chips", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "alice@example.com, bob@example.com\nchris@example.com",
      },
    });
    expect(spy).toHaveBeenLastCalledWith([
      "alice@example.com",
      "bob@example.com",
      "chris@example.com",
    ]);
  });

  it("backspace on empty draft removes the last chip", () => {
    const spy = vi.fn();
    render(<Harness initial={["a@x.com", "b@x.com"]} onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(spy).toHaveBeenLastCalledWith(["a@x.com"]);
  });

  it("backspace with non-empty draft does NOT remove a chip", () => {
    const spy = vi.fn();
    render(<Harness initial={["a@x.com"]} onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "draft" } });
    spy.mockClear();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("invalid email gets data-invalid attribute on its chip", () => {
    render(<Harness initial={["not-an-email", "ok@x.com"]} />);
    const chips = screen.getAllByTestId("email-chip");
    expect(chips[0]).toHaveAttribute("data-invalid", "true");
    expect(chips[1]).not.toHaveAttribute("data-invalid");
  });

  it("remove button on a chip removes that chip", () => {
    const spy = vi.fn();
    render(<Harness initial={["a@x.com", "b@x.com"]} onChangeSpy={spy} />);
    const removeBtn = screen.getByRole("button", {
      name: "メールアドレス a@x.com を削除",
    });
    fireEvent.click(removeBtn);
    expect(spy).toHaveBeenLastCalledWith(["b@x.com"]);
  });

  it("commits any pending draft on blur", () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = getInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenLastCalledWith(["alice@example.com"]);
  });

  it("disabled prop disables the inner input and remove buttons", () => {
    render(
      <EmailChipsInput aria-label="emails" value={["a@x.com"]} onChange={() => {}} disabled />,
    );
    expect(screen.getByLabelText("emails")).toBeDisabled();
    expect(screen.getByRole("button", { name: "メールアドレス a@x.com を削除" })).toBeDisabled();
  });
});
