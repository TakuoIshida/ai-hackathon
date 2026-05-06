import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AvailabilityRule } from "@/lib/types";
import { WeekdayHoursEditor } from "./WeekdayHoursEditor";

function Controlled({ initial = [] as AvailabilityRule[] }) {
  const [rules, setRules] = useState<AvailabilityRule[]>(initial);
  return <WeekdayHoursEditor rules={rules} onChange={setRules} />;
}

const mondayRule: AvailabilityRule = { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 };

describe("<WeekdayHoursEditor />", () => {
  it("renders all 7 weekday rows", () => {
    render(<Controlled />);
    for (const label of ["月", "火", "水", "木", "金", "土", "日"]) {
      // toggle aria-label includes the day label
      expect(screen.getByLabelText(`${label}曜日 受付`)).toBeInTheDocument();
    }
  });

  it("shows '受付なし' for off weekdays", () => {
    render(<Controlled />);
    // 7 weekdays, all off by default → 7 instances of "受付なし"
    expect(screen.getAllByText("受付なし")).toHaveLength(7);
  });

  it("toggle off → on adds a default 09:00-17:00 range", () => {
    render(<Controlled />);
    const monToggle = screen.getByLabelText("月曜日 受付");
    fireEvent.click(monToggle);
    // monday's start input now visible
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("09:00");
    expect(screen.getByLabelText("月曜日 1番目 終了時刻")).toHaveValue("17:00");
  });

  it("toggle on → off hides the time inputs and shows 受付なし", () => {
    render(<Controlled initial={[mondayRule]} />);
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("月曜日 受付"));
    expect(screen.queryByLabelText("月曜日 1番目 開始時刻")).toBeNull();
    // Switching off makes monday's column show 受付なし — there are now 7 (all weekdays off).
    expect(screen.getAllByText("受付なし")).toHaveLength(7);
  });

  it("'+追加' adds another range to the same weekday", () => {
    render(<Controlled initial={[mondayRule]} />);
    // Find monday's "追加" button — it's the only one visible (all other days are off).
    fireEvent.click(screen.getByRole("button", { name: /追加/ }));
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toBeInTheDocument();
    expect(screen.getByLabelText("月曜日 2番目 開始時刻")).toBeInTheDocument();
  });

  it("'平日に一括適用' copies monday's ranges to tue-fri", () => {
    const tightMonday: AvailabilityRule = {
      weekday: 1,
      startMinute: 10 * 60,
      endMinute: 12 * 60,
    };
    render(<Controlled initial={[tightMonday]} />);

    fireEvent.click(screen.getByRole("button", { name: /平日に一括適用/ }));

    for (const day of ["月", "火", "水", "木", "金"]) {
      expect(screen.getByLabelText(`${day}曜日 1番目 開始時刻`)).toHaveValue("10:00");
      expect(screen.getByLabelText(`${day}曜日 1番目 終了時刻`)).toHaveValue("12:00");
    }
    // 土日 stay off
    const off = screen.getAllByText("受付なし");
    expect(off).toHaveLength(2);
  });

  it("✕ removes an individual range", () => {
    const monMorning: AvailabilityRule = {
      weekday: 1,
      startMinute: 10 * 60,
      endMinute: 12 * 60,
    };
    const monAfternoon: AvailabilityRule = {
      weekday: 1,
      startMinute: 14 * 60,
      endMinute: 18 * 60,
    };
    render(<Controlled initial={[monMorning, monAfternoon]} />);

    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("10:00");
    expect(screen.getByLabelText("月曜日 2番目 開始時刻")).toHaveValue("14:00");

    fireEvent.click(screen.getByRole("button", { name: "月曜日 1番目 削除" }));

    // First range removed; afternoon range now becomes the 1st (and only).
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("14:00");
    expect(screen.queryByLabelText("月曜日 2番目 開始時刻")).toBeNull();
  });

  it("editing a range time updates the value", () => {
    render(<Controlled initial={[mondayRule]} />);
    const startInput = screen.getByLabelText("月曜日 1番目 開始時刻");
    fireEvent.change(startInput, { target: { value: "10:30" } });
    expect(screen.getByLabelText("月曜日 1番目 開始時刻")).toHaveValue("10:30");
  });
});
