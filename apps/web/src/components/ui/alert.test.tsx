import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert, AlertDescription, AlertTitle } from "./alert";

describe("<Alert />", () => {
  it("renders with role=alert and content", () => {
    render(
      <Alert variant="success">
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>Your settings were saved.</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Your settings were saved.")).toBeInTheDocument();
  });
});
