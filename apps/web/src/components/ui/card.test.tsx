import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

describe("<Card />", () => {
  it("renders all subparts together", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Description text</CardDescription>
        </CardHeader>
        <CardBody>
          <p>Body content</p>
        </CardBody>
        <CardFooter>
          <button type="button">Action</button>
        </CardFooter>
      </Card>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Description text")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });

  it("forwards additional className-aware style via the style prop", () => {
    render(<Card data-testid="card" style={{ color: "red" }} />);
    const node = screen.getByTestId("card");
    expect(node).toBeInTheDocument();
    expect(node).toHaveAttribute("style");
  });
});
