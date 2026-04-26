import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PublicLayout } from "./PublicLayout";

describe("<PublicLayout />", () => {
  it("renders the matched outlet inside the public shell", () => {
    render(
      <MemoryRouter initialEntries={["/intro-30"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/:slug" element={<div>Booking Form</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Booking Form")).toBeInTheDocument();
  });
});
