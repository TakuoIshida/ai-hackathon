import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import DevComponents from "./DevComponents";

describe("<DevComponents />", () => {
  it("renders the showcase page heading", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <DevComponents />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Components Showcase" }),
    ).toBeInTheDocument();
  });

  it("renders section headings for each catalog group", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <DevComponents />
        </ToastProvider>
      </MemoryRouter>,
    );
    for (const name of ["Foundation", "Form", "Display", "Feedback", "Overlay", "Navigation"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });
});
