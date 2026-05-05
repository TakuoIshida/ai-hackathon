import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("<Badge />", () => {
  it("renders children", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("accepts variant prop", () => {
    render(<Badge variant="success">OK</Badge>);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });
});
