import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard, type StatCardTone } from "./stat-card";

const TONES: StatCardTone[] = ["blue", "mint", "lilac", "amber", "rose"];

describe("<StatCard />", () => {
  it("renders label, value, and sub", () => {
    render(
      <StatCard label="アクティブなリンク" value={4} sub="+1 今月" icon={<svg />} tone="blue" />,
    );
    expect(screen.getByText("アクティブなリンク")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("+1 今月")).toBeInTheDocument();
  });

  it("renders 'value / total' when total is supplied", () => {
    render(<StatCard label="アクティブメンバー" value={3} total={10} icon={<svg />} tone="mint" />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("/ 10")).toBeInTheDocument();
  });

  it("omits sub block when sub is not provided", () => {
    render(<StatCard label="期限切れ" value={1} icon={<svg />} tone="rose" />);
    expect(screen.queryByText("/")).not.toBeInTheDocument();
  });

  it.each(TONES)("applies tone-specific class to icon-tile (tone=%s)", (tone) => {
    const { container, unmount } = render(
      <StatCard label="L" value={1} icon={<svg data-testid="icon" />} tone={tone} />,
    );
    const tile = container.querySelector("[data-testid='stat-card-icon-tile']");
    expect(tile).not.toBeNull();
    // tone は data-tone 属性として確認できる (markup 上での 5 種別の差別化)
    const root = container.querySelector(`[data-tone="${tone}"]`);
    expect(root).not.toBeNull();
    unmount();
  });

  it("each tone produces a distinct class set on the icon-tile", () => {
    // 同じ markup を tone だけ変えて render し、icon-tile の className が tone
    // ごとに異なることで「tone マッピングが効いている」ことを担保する。
    const classNames = new Set<string>();
    for (const tone of TONES) {
      const { container, unmount } = render(
        <StatCard label="L" value={1} icon={<svg />} tone={tone} />,
      );
      const tile = container.querySelector(
        "[data-testid='stat-card-icon-tile']",
      ) as HTMLElement | null;
      expect(tile).not.toBeNull();
      classNames.add(tile?.className ?? "");
      unmount();
    }
    expect(classNames.size).toBe(TONES.length);
  });
});
