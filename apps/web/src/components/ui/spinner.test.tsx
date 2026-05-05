import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner";

describe("<Spinner />", () => {
  it("renders with role=status and default label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading…" })).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<Spinner label="Saving" />);
    expect(screen.getByRole("status", { name: "Saving" })).toBeInTheDocument();
  });
});
