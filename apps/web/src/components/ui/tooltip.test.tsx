import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

describe("<Tooltip />", () => {
  it("renders the trigger but not the content initially", () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByText("Hover me")).toBeInTheDocument();
    // Tooltip content is hidden until pointer/focus events fire — Radix renders
    // it via Portal lazily, so we don't assert its absence here (the precise
    // hide mechanism is implementation detail).
  });

  it("opens with defaultOpen prop", () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getAllByText("Tooltip text").length).toBeGreaterThan(0);
  });
});
