import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationPeriodCard } from "./PublicationPeriodCard";

function Controlled({
  initialFrom = "2026-05-06",
  initialTo = "2026-06-05",
  initialDays = 30 as number | null,
}: {
  initialFrom?: string;
  initialTo?: string;
  initialDays?: number | null;
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [activeDays, setActiveDays] = useState<number | null>(initialDays);
  return (
    <PublicationPeriodCard
      from={from}
      to={to}
      activeDays={activeDays}
      onChange={(next) => {
        setFrom(next.from);
        setTo(next.to);
        setActiveDays(next.activeDays);
      }}
    />
  );
}

describe("<PublicationPeriodCard />", () => {
  beforeEach(() => {
    // Pin "today" so addDays() output is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 6)); // 2026-05-06 local
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the title, both date inputs, and 4 preset chips", () => {
    render(<Controlled />);
    expect(screen.getByText("公開期間")).toBeInTheDocument();
    expect(screen.getByLabelText("公開期間 開始日")).toHaveValue("2026-05-06");
    expect(screen.getByLabelText("公開期間 終了日")).toHaveValue("2026-06-05");
    expect(screen.getByRole("button", { name: "1週間" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2週間" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1ヶ月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3ヶ月" })).toBeInTheDocument();
  });

  it("marks the matching preset as active (aria-pressed)", () => {
    render(<Controlled initialDays={30} />);
    expect(screen.getByRole("button", { name: "1ヶ月" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1週間" })).toHaveAttribute("aria-pressed", "false");
  });

  it("preset click sets from=today and to=today+days", () => {
    render(<Controlled initialFrom="2026-01-01" initialTo="2026-01-08" initialDays={null} />);
    fireEvent.click(screen.getByRole("button", { name: "2週間" }));
    expect(screen.getByLabelText("公開期間 開始日")).toHaveValue("2026-05-06");
    expect(screen.getByLabelText("公開期間 終了日")).toHaveValue("2026-05-20");
    expect(screen.getByRole("button", { name: "2週間" })).toHaveAttribute("aria-pressed", "true");
  });

  it("manually editing the to-date clears the active preset", () => {
    render(<Controlled initialDays={30} />);
    fireEvent.change(screen.getByLabelText("公開期間 終了日"), {
      target: { value: "2026-07-01" },
    });
    // Now no preset is active
    expect(screen.getByRole("button", { name: "1ヶ月" })).toHaveAttribute("aria-pressed", "false");
  });
});
