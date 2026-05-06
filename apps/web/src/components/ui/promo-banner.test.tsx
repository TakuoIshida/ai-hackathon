import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromoBanner } from "./promo-banner";

describe("<PromoBanner />", () => {
  it("renders title, description, and both actions", () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      <PromoBanner
        title="お試し期間中は空き時間リンクを無制限にご利用いただけます"
        description="2026/05/25まで"
        primaryAction={{ label: "プランについて", onClick: onPrimary }}
        secondaryAction={{ label: "詳細を見る", onClick: onSecondary }}
      />,
    );

    expect(
      screen.getByText("お試し期間中は空き時間リンクを無制限にご利用いただけます"),
    ).toBeInTheDocument();
    expect(screen.getByText("2026/05/25まで")).toBeInTheDocument();

    const primary = screen.getByRole("button", { name: "プランについて" });
    const secondary = screen.getByRole("button", { name: "詳細を見る" });
    fireEvent.click(primary);
    fireEvent.click(secondary);
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("renders without description and actions", () => {
    render(<PromoBanner title="Title only" />);
    expect(screen.getByText("Title only")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a custom icon when provided", () => {
    render(<PromoBanner title="With icon" icon={<svg data-testid="custom-icon" />} />);
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });
});
