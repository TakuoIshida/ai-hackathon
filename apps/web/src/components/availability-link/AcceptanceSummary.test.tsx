import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AvailabilityRule } from "@/lib/types";
import {
  AcceptanceSummary,
  computeTotalMinutesPerWeek,
  formatActiveDaysLabel,
} from "./AcceptanceSummary";

describe("formatActiveDaysLabel", () => {
  it("returns '未設定' when no weekdays are active", () => {
    expect(formatActiveDaysLabel([])).toBe("未設定");
  });

  it("returns the single weekday label when only one is active", () => {
    expect(formatActiveDaysLabel([3])).toBe("水");
  });

  it("returns 'A〜B' for a contiguous run of >=3 days starting Monday", () => {
    expect(formatActiveDaysLabel([1, 2, 3, 4, 5])).toBe("月〜金");
  });

  it("returns the comma-joined label for non-contiguous days", () => {
    expect(formatActiveDaysLabel([1, 3, 5])).toBe("月, 水, 金");
  });
});

describe("computeTotalMinutesPerWeek", () => {
  it("sums every range's span across rules", () => {
    const rules: AvailabilityRule[] = [
      { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }, // 480
      { weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 }, // 180
      { weekday: 2, startMinute: 13 * 60, endMinute: 17 * 60 }, // 240
    ];
    expect(computeTotalMinutesPerWeek(rules)).toBe(480 + 180 + 240);
  });
});

describe("<AcceptanceSummary />", () => {
  it("renders the three summary rows with computed values", () => {
    const rules: AvailabilityRule[] = [
      { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
      { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
      { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 },
      { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60 },
      { weekday: 5, startMinute: 9 * 60, endMinute: 17 * 60 },
    ];
    render(<AcceptanceSummary rules={rules} durationMinutes={30} />);
    expect(screen.getByText("受付サマリー")).toBeInTheDocument();
    expect(screen.getByText("受付曜日")).toBeInTheDocument();
    expect(screen.getByText("月〜金")).toBeInTheDocument();
    expect(screen.getByText("40時間 / 週")).toBeInTheDocument();
    expect(screen.getByText("予約可能枠 (30分)")).toBeInTheDocument();
    expect(screen.getByText("80 枠 / 週")).toBeInTheDocument();
  });

  it("handles zero rules gracefully", () => {
    render(<AcceptanceSummary rules={[]} durationMinutes={30} />);
    expect(screen.getByText("未設定")).toBeInTheDocument();
    expect(screen.getByText("0時間 / 週")).toBeInTheDocument();
    expect(screen.getByText("0 枠 / 週")).toBeInTheDocument();
  });
});
