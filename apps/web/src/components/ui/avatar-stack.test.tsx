import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvatarStack, type AvatarStackMember } from "./avatar-stack";

const members5: AvatarStackMember[] = [
  { name: "Alice Anderson" },
  { name: "Bob Brown" },
  { name: "Carol Chen" },
  { name: "Dan Davis" },
  { name: "Eve Evans" },
];

describe("<AvatarStack />", () => {
  it("renders a single member without overflow", () => {
    render(<AvatarStack members={[{ name: "Alice Anderson" }]} />);
    expect(screen.getByLabelText("Alice Anderson")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    expect(screen.getByText("1名")).toBeInTheDocument();
  });

  it("renders 3 members at max=3 without overflow", () => {
    render(<AvatarStack members={members5.slice(0, 3)} max={3} />);
    expect(screen.getByLabelText("Alice Anderson")).toBeInTheDocument();
    expect(screen.getByLabelText("Bob Brown")).toBeInTheDocument();
    expect(screen.getByLabelText("Carol Chen")).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(screen.getByText("3名")).toBeInTheDocument();
  });

  it("renders +N overflow chip when members exceed max", () => {
    render(<AvatarStack members={members5} max={3} />);
    // First 3 visible, last 2 collapsed into +2.
    expect(screen.getByLabelText("Alice Anderson")).toBeInTheDocument();
    expect(screen.getByLabelText("Bob Brown")).toBeInTheDocument();
    expect(screen.getByLabelText("Carol Chen")).toBeInTheDocument();
    expect(screen.queryByLabelText("Dan Davis")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Eve Evans")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByLabelText("他 2 名")).toBeInTheDocument();
    expect(screen.getByText("5名")).toBeInTheDocument();
  });

  it("hides the count label when showCount is false", () => {
    render(<AvatarStack members={members5.slice(0, 3)} showCount={false} />);
    expect(screen.queryByText("3名")).not.toBeInTheDocument();
  });

  it("shows the count label by default", () => {
    render(<AvatarStack members={members5.slice(0, 3)} />);
    expect(screen.getByText("3名")).toBeInTheDocument();
  });
});
