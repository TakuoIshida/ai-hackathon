import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";
import { Label } from "./label";

describe("<Label />", () => {
  it("associates with an input via htmlFor", () => {
    render(
      <>
        <Label htmlFor="tz">タイムゾーン</Label>
        <Input id="tz" defaultValue="Asia/Tokyo" />
      </>,
    );
    const label = screen.getByText("タイムゾーン");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "tz");
  });
});
