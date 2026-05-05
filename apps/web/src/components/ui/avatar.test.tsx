import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarFallback } from "./avatar";

describe("<Avatar />", () => {
  it("renders the fallback text", () => {
    render(
      <Avatar>
        <AvatarFallback>TI</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText("TI")).toBeInTheDocument();
  });

  it("accepts a size prop", () => {
    render(
      <Avatar size="lg" data-testid="av">
        <AvatarFallback>X</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId("av")).toBeInTheDocument();
  });
});
