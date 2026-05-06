import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import {
  __testing,
  CalendarDragGrid,
  type CalendarDragGridProps,
  type CandidateSlot,
} from "./CalendarDragGrid";

// JSDOM does not implement layout, so getBoundingClientRect returns zeros and
// our snap-to-quarter-hour math degenerates. Stub it per element to give
// each day-col a deterministic 7×56*11 = 56 px-per-hour rectangle starting at
// y=0.
const HOUR_PX = 56;
const COL_HEIGHT = HOUR_PX * 11; // 8:00 → 18:00

beforeAll(() => {
  // For day cols, top=0, bottom=COL_HEIGHT. left/right do not matter for tests.
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: COL_HEIGHT,
      width: 100,
      height: COL_HEIGHT,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
});

function Harness({
  initialCandidates = [] as CandidateSlot[],
  busy = [] as CalendarDragGridProps["busy"],
  onCandidatesChange,
}: {
  initialCandidates?: CandidateSlot[];
  busy?: CalendarDragGridProps["busy"];
  onCandidatesChange?: (next: CandidateSlot[]) => void;
}) {
  const [candidates, setCandidates] = React.useState<CandidateSlot[]>(initialCandidates);
  const [weekStart, setWeekStart] = React.useState<Date>(() =>
    __testing.startOfWeekMonday(new Date(2026, 4, 11)),
  );
  return (
    <ToastProvider>
      <CalendarDragGrid
        candidates={candidates}
        busy={busy}
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        onCandidatesChange={(next) => {
          setCandidates(next);
          onCandidatesChange?.(next);
        }}
      />
    </ToastProvider>
  );
}

// y-coord (relative to col top) for a given hour. col extends 8h..18h.
function yForHour(h: number): number {
  return (h - 8) * HOUR_PX;
}

describe("<CalendarDragGrid />", () => {
  it("renders busy events and existing candidates", () => {
    render(
      <Harness
        busy={[{ weekDay: 0, startMin: 9 * 60, endMin: 10 * 60, title: "朝会" }]}
        initialCandidates={[{ id: "c1", weekDay: 1, startMin: 13 * 60, endMin: 15 * 60 }]}
      />,
    );
    expect(screen.getByText("朝会")).toBeInTheDocument();
    expect(screen.getByTestId("candidate-c1")).toBeInTheDocument();
    // Hint banner
    expect(screen.getByText(/カレンダーをドラッグして候補時間を追加/)).toBeInTheDocument();
  });

  it("creates a new candidate via mousedown→mousemove→mouseup on an empty cell", () => {
    const onChange = vi.fn();
    render(<Harness onCandidatesChange={onChange} />);

    const col = screen.getByTestId("day-col-2"); // Wednesday
    // mousedown at 10:00, mousemove to 12:00, mouseup
    fireEvent.mouseDown(col, { button: 0, clientY: yForHour(10) });
    fireEvent.mouseMove(window, { clientY: yForHour(12) });
    fireEvent.mouseUp(window);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as CandidateSlot[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      weekDay: 2,
      startMin: 10 * 60,
      endMin: 12 * 60,
    });
  });

  it("does not create a candidate when the drag overlaps an existing busy event", () => {
    const onChange = vi.fn();
    render(
      <Harness
        busy={[{ weekDay: 0, startMin: 9 * 60, endMin: 10 * 60, title: "朝会" }]}
        onCandidatesChange={onChange}
      />,
    );
    const col = screen.getByTestId("day-col-0");
    fireEvent.mouseDown(col, { button: 0, clientY: yForHour(9) });
    fireEvent.mouseMove(window, { clientY: yForHour(10) });
    fireEvent.mouseUp(window);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("resizes a candidate via the bottom handle", () => {
    const onChange = vi.fn();
    const initial: CandidateSlot[] = [{ id: "c1", weekDay: 0, startMin: 10 * 60, endMin: 12 * 60 }];
    render(<Harness initialCandidates={initial} onCandidatesChange={onChange} />);

    const handle = screen.getByTestId("resize-bottom-c1");
    fireEvent.mouseDown(handle, { button: 0, clientY: yForHour(12) });
    // drag bottom handle to 14:00
    fireEvent.mouseMove(window, { clientY: yForHour(14) });
    fireEvent.mouseUp(window);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as CandidateSlot[];
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "c1",
      weekDay: 0,
      startMin: 10 * 60,
      endMin: 14 * 60,
    });
  });

  it("removes a candidate when the close button is clicked", () => {
    const onChange = vi.fn();
    const initial: CandidateSlot[] = [
      { id: "c1", weekDay: 0, startMin: 10 * 60, endMin: 12 * 60 },
      { id: "c2", weekDay: 1, startMin: 11 * 60, endMin: 12 * 60 },
    ];
    render(<Harness initialCandidates={initial} onCandidatesChange={onChange} />);

    // hover c1 to surface the delete button
    const card = screen.getByTestId("candidate-c1");
    fireEvent.mouseEnter(card);
    const del = screen.getByTestId("delete-c1");
    fireEvent.click(del);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as CandidateSlot[];
    expect(next.map((c) => c.id)).toEqual(["c2"]);
  });

  it("week navigation: 次の週 advances by 7 days", () => {
    render(<Harness />);
    const labelBefore = screen.getByText(/2026年 5月/).textContent ?? "";
    fireEvent.click(screen.getByRole("button", { name: "次の週" }));
    const labelAfter = screen.getByText(/2026年 5月|2026年 6月/).textContent ?? "";
    expect(labelAfter).not.toBe(labelBefore);
  });
});
