import * as stylex from "@stylexjs/stylex";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

/**
 * カレンダードラッグ mode (ISH-245 / C-03) — 週間 grid 上で空白セルを
 * mouse drag して候補時間帯 (CandidateSlot) を作成・移動・リサイズ・削除する
 * UI。
 *
 * 操作対象は親が握る `candidates` 配列で、`onCandidatesChange` で次の状態を
 * 通知する controlled component。週切替も `weekStart` / `onWeekChange` で
 * controlled。
 *
 * 既知の制約:
 * - busy データは props で渡す前提 (本 issue では LinkForm 側で mock を使用)。
 *   freebusy API 連携は別 issue。
 * - 永続化はしない。ISH-245 後続 issue で BE schema 拡張と合わせて wiring。
 * - 表示時間帯は固定 8:00–18:00 (HOUR_PX=56)。
 */

export interface CandidateSlot {
  /** ULID-like id. 親が `crypto.randomUUID()` 等で発番してもよい。 */
  id: string;
  /** 0 = Mon, 1 = Tue, ..., 6 = Sun (週の起算は weekStart に従う)。 */
  weekDay: number;
  /** 1日の開始からの分。 */
  startMin: number;
  /** 1日の開始からの分。startMin < endMin。 */
  endMin: number;
}

export interface BusySlot {
  weekDay: number;
  startMin: number;
  endMin: number;
  title?: string;
}

export interface CalendarDragGridProps {
  candidates: CandidateSlot[];
  busy: BusySlot[];
  onCandidatesChange: (next: CandidateSlot[]) => void;
  /** 表示する週の開始日 (月曜想定)。 */
  weekStart: Date;
  onWeekChange: (next: Date) => void;
}

// --- constants ---------------------------------------------------------------

const HOUR_PX = 56;
const START_HOUR = 8;
const END_HOUR = 18;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;
const SNAP_MIN = 15;
const MIN_DURATION_MIN = 15;

// --- helpers -----------------------------------------------------------------

/** y(px, day-col 内の相対座標) → 当日のスタート分。15分 snap。 */
function snapToQuarterHour(yPx: number): number {
  const total = (yPx / HOUR_PX) * 60 + START_HOUR * 60;
  const snapped = Math.round(total / SNAP_MIN) * SNAP_MIN;
  return Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, snapped));
}

function minutesToTopPx(min: number): number {
  return ((min - START_HOUR * 60) / 60) * HOUR_PX;
}

function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function formatRange(startMin: number, endMin: number): string {
  return `${formatMin(startMin)} – ${formatMin(endMin)}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** 月曜起点で週の頭に揃える。 */
function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  // getDay: Sun=0..Sat=6 → Mon-based: (Sun→6, Mon→0, ..., Sat→5)
  const offset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

function formatWeekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const y = weekStart.getFullYear();
  const sm = weekStart.getMonth() + 1;
  const sd = weekStart.getDate();
  const ed = end.getDate();
  const em = end.getMonth() + 1;
  if (sm === em) return `${y}年 ${sm}月 ${sd}日 — ${ed}日`;
  return `${y}年 ${sm}月 ${sd}日 — ${em}月 ${ed}日`;
}

function overlaps(
  a: { startMin: number; endMin: number },
  b: { startMin: number; endMin: number },
): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- styles ------------------------------------------------------------------

const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.md },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: "0.625rem",
  },
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.75rem",
    height: "1.75rem",
    borderRadius: radius.sm,
    border: `1px solid ${colors.ink200}`,
    background: { default: colors.bg, ":hover": colors.bgSoft },
    color: colors.ink700,
    cursor: "pointer",
    padding: 0,
  },
  weekLabel: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  legend: {
    marginInlineStart: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: typography.fontSizeXs,
    color: colors.ink700,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: "6px" },
  legendSwatchCandidate: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: colors.blue300,
  },
  legendSwatchBusy: {
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: colors.ink200,
    border: `1px dashed ${colors.ink400}`,
  },
  card: {
    borderRadius: radius.md,
    border: `1px solid ${colors.ink200}`,
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  headerRow: {
    display: "grid",
    gridTemplateColumns: "48px repeat(7, 1fr)",
    borderBottom: `1px solid ${colors.ink200}`,
    backgroundColor: colors.bg,
  },
  headerCell: {
    padding: "10px 8px",
    textAlign: "center",
    borderInlineStart: `1px solid ${colors.ink100}`,
  },
  headerDay: { fontSize: 11, color: colors.ink500 },
  headerDayWeekend: { fontSize: 11, color: colors.rose500 },
  headerDate: {
    fontSize: 18,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    marginTop: 2,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "48px repeat(7, 1fr)",
    position: "relative",
    userSelect: "none",
  },
  hourCol: { position: "relative" },
  hourRow: {
    height: HOUR_PX,
    position: "relative",
    borderTop: `1px solid ${colors.ink100}`,
  },
  hourLabel: {
    position: "absolute",
    top: -7,
    right: 8,
    fontSize: 11,
    color: colors.ink400,
    backgroundColor: colors.bg,
    padding: "0 2px",
  },
  dayCol: {
    position: "relative",
    borderInlineStart: `1px solid ${colors.ink100}`,
  },
  hourSlot: {
    height: HOUR_PX,
    borderTop: `1px solid ${colors.ink100}`,
  },
  busy: {
    position: "absolute",
    left: 4,
    right: 4,
    background: `repeating-linear-gradient(45deg, ${colors.ink100} 0 6px, transparent 6px 10px), ${colors.ink50}`,
    border: `1px dashed ${colors.ink300}`,
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 11,
    color: colors.ink500,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    pointerEvents: "none",
  },
  busyTitle: { fontWeight: typography.fontWeightBold },
  candidate: {
    position: "absolute",
    left: 4,
    right: 4,
    background: "linear-gradient(180deg, rgba(127,176,209,0.45), rgba(127,176,209,0.32))",
    border: `1.5px solid ${colors.blue500}`,
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 11,
    color: colors.blue900,
    display: "flex",
    flexDirection: "column",
    cursor: "grab",
    boxShadow: shadow.sm,
  },
  candidateLabel: { fontWeight: typography.fontWeightBold },
  candidateGhost: { opacity: 0.55 },
  candidateInvalid: {
    background: "rgba(217, 105, 95, 0.18)",
    borderColor: colors.rose500,
  },
  resizeHandle: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    width: 18,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.blue600,
    cursor: "ns-resize",
  },
  resizeHandleTop: { top: -3 },
  resizeHandleBottom: { bottom: -3 },
  closeBtn: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "none",
    backgroundColor: colors.blue900,
    color: colors.primaryFg,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    boxShadow: shadow.sm,
  },
  preview: {
    position: "absolute",
    background: "linear-gradient(180deg, rgba(127,176,209,0.55), rgba(127,176,209,0.40))",
    border: `1.5px dashed ${colors.blue500}`,
    borderRadius: 8,
    pointerEvents: "none",
  },
  tooltip: {
    position: "absolute",
    backgroundColor: colors.blue900,
    color: colors.primaryFg,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    boxShadow: shadow.lg,
    pointerEvents: "none",
    zIndex: 5,
    whiteSpace: "nowrap",
  },
  tooltipTitle: { fontWeight: typography.fontWeightBold, marginBottom: 2 },
  hint: {
    padding: "10px 14px",
    background: colors.blue50,
    border: `1px dashed ${colors.blue200}`,
    borderRadius: 10,
    fontSize: 12,
    color: colors.blue800,
  },
});

// --- drag state --------------------------------------------------------------

type DragState =
  | { kind: "idle" }
  | {
      kind: "create";
      weekDay: number;
      anchorMin: number;
      currentMin: number;
      pointerX: number;
      pointerY: number;
    }
  | {
      kind: "move";
      id: string;
      weekDay: number;
      startMin: number;
      endMin: number;
      // anchor snapshot (to compute delta)
      anchorYMin: number;
      anchorClientY: number;
      pointerX: number;
      pointerY: number;
    }
  | {
      kind: "resize";
      id: string;
      weekDay: number;
      startMin: number;
      endMin: number;
      edge: "start" | "end";
      pointerX: number;
      pointerY: number;
    };

// --- component ---------------------------------------------------------------

export function CalendarDragGrid({
  candidates,
  busy,
  onCandidatesChange,
  weekStart,
  onWeekChange,
}: CalendarDragGridProps) {
  const { toast } = useToast();
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const dayColRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = React.useState<DragState>({ kind: "idle" });
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  const dayDates = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  // ----- helpers (closures on candidates) -----
  const findOverlap = React.useCallback(
    (
      target: { weekDay: number; startMin: number; endMin: number },
      ignoreId?: string,
    ): { kind: "busy"; slot: BusySlot } | { kind: "candidate"; slot: CandidateSlot } | null => {
      for (const b of busy) {
        if (b.weekDay !== target.weekDay) continue;
        if (overlaps(target, b)) return { kind: "busy", slot: b };
      }
      for (const c of candidates) {
        if (c.id === ignoreId) continue;
        if (c.weekDay !== target.weekDay) continue;
        if (overlaps(target, c)) return { kind: "candidate", slot: c };
      }
      return null;
    },
    [busy, candidates],
  );

  // ----- mouseup / mousemove on window while dragging -----
  React.useEffect(() => {
    if (drag.kind === "idle") return;

    const onMove = (ev: MouseEvent) => {
      setDrag((prev) => {
        if (prev.kind === "idle") return prev;
        const colEl = dayColRefs.current[prev.weekDay];
        if (!colEl) return { ...prev, pointerX: ev.clientX, pointerY: ev.clientY };
        const rect = colEl.getBoundingClientRect();
        const yPx = ev.clientY - rect.top;
        const min = snapToQuarterHour(yPx);
        if (prev.kind === "create") {
          return { ...prev, currentMin: min, pointerX: ev.clientX, pointerY: ev.clientY };
        }
        if (prev.kind === "move") {
          const deltaMin =
            snapToQuarterHour(ev.clientY - rect.top) -
            snapToQuarterHour(prev.anchorClientY - rect.top);
          // duration を保ったまま start/end をずらす。
          const duration = prev.endMin - prev.startMin;
          const minStart = START_HOUR * 60;
          const maxStart = END_HOUR * 60 - duration;
          const newStart = Math.max(minStart, Math.min(maxStart, prev.anchorYMin + deltaMin));
          return {
            ...prev,
            startMin: newStart,
            endMin: newStart + duration,
            pointerX: ev.clientX,
            pointerY: ev.clientY,
          };
        }
        if (prev.kind === "resize") {
          if (prev.edge === "start") {
            const newStart = Math.min(prev.endMin - MIN_DURATION_MIN, min);
            return {
              ...prev,
              startMin: Math.max(START_HOUR * 60, newStart),
              pointerX: ev.clientX,
              pointerY: ev.clientY,
            };
          }
          const newEnd = Math.max(prev.startMin + MIN_DURATION_MIN, min);
          return {
            ...prev,
            endMin: Math.min(END_HOUR * 60, newEnd),
            pointerX: ev.clientX,
            pointerY: ev.clientY,
          };
        }
        return prev;
      });
    };

    const onUp = () => {
      // ISH-296 (A): conflict 判定 / toast() / onCandidatesChange は setDrag の
      // updater の外で行う。React 18 StrictMode では updater が dev 中に 2 回
      // 実行されるため、updater 内で副作用 (toast 等) を起こすと duplicate snackbar
      // が出る。updater は純粋に "idle に戻す" だけにし、effect は事前に確定させる。
      // (`drag.kind === "idle"` はこの effect の入口で early-return してあり、
      //  `prev` には "idle" 以外しか入らない。)
      const prev = drag;

      if (prev.kind === "create") {
        const startMin = Math.min(prev.anchorMin, prev.currentMin);
        const endMin = Math.max(prev.anchorMin, prev.currentMin);
        if (endMin - startMin < MIN_DURATION_MIN) {
          setDrag({ kind: "idle" });
          return;
        }
        const conflict = findOverlap({ weekDay: prev.weekDay, startMin, endMin });
        if (conflict) {
          toast({
            title: "重なっています",
            description:
              conflict.kind === "busy"
                ? "既存の予定と重なる時間帯には候補を作成できません。"
                : "他の候補時間と重なります。",
            variant: "destructive",
          });
          setDrag({ kind: "idle" });
          return;
        }
        onCandidatesChange([
          ...candidates,
          { id: genId(), weekDay: prev.weekDay, startMin, endMin },
        ]);
        setDrag({ kind: "idle" });
        return;
      }

      if (prev.kind === "move") {
        const conflict = findOverlap(
          { weekDay: prev.weekDay, startMin: prev.startMin, endMin: prev.endMin },
          prev.id,
        );
        if (conflict) {
          toast({
            title: "重なっています",
            description:
              conflict.kind === "busy"
                ? "既存の予定と重なる位置には移動できません。"
                : "他の候補時間と重なります。",
            variant: "destructive",
          });
          setDrag({ kind: "idle" });
          return;
        }
        onCandidatesChange(
          candidates.map((c) =>
            c.id === prev.id ? { ...c, startMin: prev.startMin, endMin: prev.endMin } : c,
          ),
        );
        setDrag({ kind: "idle" });
        return;
      }

      if (prev.kind === "resize") {
        if (prev.endMin - prev.startMin < MIN_DURATION_MIN) {
          setDrag({ kind: "idle" });
          return;
        }
        const conflict = findOverlap(
          { weekDay: prev.weekDay, startMin: prev.startMin, endMin: prev.endMin },
          prev.id,
        );
        if (conflict) {
          toast({
            title: "重なっています",
            description:
              conflict.kind === "busy"
                ? "既存の予定と重なるリサイズはできません。"
                : "他の候補時間と重なります。",
            variant: "destructive",
          });
          setDrag({ kind: "idle" });
          return;
        }
        onCandidatesChange(
          candidates.map((c) =>
            c.id === prev.id ? { ...c, startMin: prev.startMin, endMin: prev.endMin } : c,
          ),
        );
        setDrag({ kind: "idle" });
        return;
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, candidates, findOverlap, onCandidatesChange, toast]);

  // ----- handlers -----
  const onDayColMouseDown = (e: React.MouseEvent<HTMLDivElement>, weekDay: number) => {
    // ignore right-click and clicks that originated on a child interactive element
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) {
      // mousedown が day col の "background" ではなく candidate / busy / handle の上にあった場合は無視。
      // child でも data-bg="cell" を持っていれば bypass。
      const t = e.target as HTMLElement;
      if (t.getAttribute("data-bg") !== "cell") return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const yPx = e.clientY - rect.top;
    const anchor = snapToQuarterHour(yPx);
    setDrag({
      kind: "create",
      weekDay,
      anchorMin: anchor,
      currentMin: Math.min(END_HOUR * 60, anchor + SNAP_MIN),
      pointerX: e.clientX,
      pointerY: e.clientY,
    });
    e.preventDefault();
  };

  const onCandidateMouseDown = (e: React.MouseEvent, c: CandidateSlot) => {
    if (e.button !== 0) return;
    const colEl = dayColRefs.current[c.weekDay];
    if (!colEl) return;
    const rect = colEl.getBoundingClientRect();
    const yPx = e.clientY - rect.top;
    setDrag({
      kind: "move",
      id: c.id,
      weekDay: c.weekDay,
      startMin: c.startMin,
      endMin: c.endMin,
      anchorYMin: c.startMin,
      anchorClientY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
    });
    void rect;
    void yPx;
    e.preventDefault();
    e.stopPropagation();
  };

  const onResizeMouseDown = (e: React.MouseEvent, c: CandidateSlot, edge: "start" | "end") => {
    if (e.button !== 0) return;
    setDrag({
      kind: "resize",
      id: c.id,
      weekDay: c.weekDay,
      startMin: c.startMin,
      endMin: c.endMin,
      edge,
      pointerX: e.clientX,
      pointerY: e.clientY,
    });
    e.preventDefault();
    e.stopPropagation();
  };

  const onDeleteCandidate = (id: string) => {
    onCandidatesChange(candidates.filter((c) => c.id !== id));
  };

  const goPrev = () => onWeekChange(addDays(weekStart, -7));
  const goNext = () => onWeekChange(addDays(weekStart, 7));
  const goToday = () => onWeekChange(startOfWeekMonday(new Date()));

  // active drag に応じて差分プレビュー / 候補表示を上書き
  const previewCandidate = React.useMemo<{
    weekDay: number;
    startMin: number;
    endMin: number;
    invalid: boolean;
  } | null>(() => {
    if (drag.kind === "create") {
      const startMin = Math.min(drag.anchorMin, drag.currentMin);
      const endMin = Math.max(drag.anchorMin, drag.currentMin);
      if (endMin - startMin < SNAP_MIN) return null;
      const conflict = findOverlap({ weekDay: drag.weekDay, startMin, endMin });
      return { weekDay: drag.weekDay, startMin, endMin, invalid: Boolean(conflict) };
    }
    return null;
  }, [drag, findOverlap]);

  const tooltip = React.useMemo<{
    x: number;
    y: number;
    title: string;
    range: string;
  } | null>(() => {
    if (drag.kind === "idle") return null;
    if (drag.kind === "create") {
      const startMin = Math.min(drag.anchorMin, drag.currentMin);
      const endMin = Math.max(drag.anchorMin, drag.currentMin);
      const date = dayDates[drag.weekDay];
      if (!date) return null;
      const m = date.getMonth() + 1;
      const d = date.getDate();
      const dl = DAY_LABELS[drag.weekDay];
      return {
        x: drag.pointerX,
        y: drag.pointerY,
        title: "新しい候補時間",
        range: `${m}/${d} (${dl}) ${formatRange(startMin, endMin)}`,
      };
    }
    if (drag.kind === "move" || drag.kind === "resize") {
      return {
        x: drag.pointerX,
        y: drag.pointerY,
        title: drag.kind === "move" ? "候補時間を移動" : "候補時間をリサイズ",
        range: formatRange(drag.startMin, drag.endMin),
      };
    }
    return null;
  }, [drag, dayDates]);

  // candidate を render する際、drag 中なら drag.startMin/endMin に差し替える
  const liveCandidates = React.useMemo<CandidateSlot[]>(() => {
    if (drag.kind === "move" || drag.kind === "resize") {
      return candidates.map((c) =>
        c.id === drag.id ? { ...c, startMin: drag.startMin, endMin: drag.endMin } : c,
      );
    }
    return candidates;
  }, [candidates, drag]);

  // tooltip position is fixed to viewport (clientX/Y) — render relative to grid using getBoundingClientRect.
  const [gridOrigin, setGridOrigin] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  React.useEffect(() => {
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    setGridOrigin({ x: rect.left, y: rect.top });
  }, []);
  React.useEffect(() => {
    if (drag.kind === "idle") return;
    const onScroll = () => {
      if (!gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      setGridOrigin({ x: rect.left, y: rect.top });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [drag.kind]);

  return (
    <div {...stylex.props(styles.root)}>
      {/* Toolbar */}
      <div {...stylex.props(styles.toolbar)}>
        <Button variant="secondary" size="sm" onClick={goToday}>
          今週
        </Button>
        <button
          type="button"
          {...stylex.props(styles.iconBtn)}
          aria-label="前の週"
          onClick={goPrev}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          {...stylex.props(styles.iconBtn)}
          aria-label="次の週"
          onClick={goNext}
        >
          <ChevronRight size={16} />
        </button>
        <div {...stylex.props(styles.weekLabel)}>{formatWeekLabel(weekStart)}</div>
        <div {...stylex.props(styles.legend)}>
          <span {...stylex.props(styles.legendItem)}>
            <span {...stylex.props(styles.legendSwatchCandidate)} aria-hidden="true" />
            候補時間
          </span>
          <span {...stylex.props(styles.legendItem)}>
            <span {...stylex.props(styles.legendSwatchBusy)} aria-hidden="true" />
            既存予定
          </span>
        </div>
      </div>

      {/* Card with header + grid */}
      <div {...stylex.props(styles.card)}>
        {/* Day header */}
        <div {...stylex.props(styles.headerRow)}>
          <div />
          {DAY_LABELS.map((label, i) => {
            const date = dayDates[i];
            return (
              <div key={label} {...stylex.props(styles.headerCell)}>
                <div {...stylex.props(i >= 5 ? styles.headerDayWeekend : styles.headerDay)}>
                  {label}
                </div>
                <div {...stylex.props(styles.headerDate)}>{date?.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div
          {...stylex.props(styles.grid)}
          ref={gridRef}
          role="application"
          aria-label="週間カレンダー"
        >
          {/* Hour labels column */}
          <div {...stylex.props(styles.hourCol)}>
            {HOURS.map((h) => (
              <div key={h} {...stylex.props(styles.hourRow)}>
                <span {...stylex.props(styles.hourLabel)}>{h}:00</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {DAY_LABELS.map((label, di) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: drag-to-create on a 2D time grid; keyboard alternative is the form mode (C-02)
            <div
              key={label}
              ref={(el) => {
                dayColRefs.current[di] = el;
              }}
              {...stylex.props(styles.dayCol)}
              data-bg="cell"
              data-day={di}
              data-testid={`day-col-${di}`}
              onMouseDown={(e) => onDayColMouseDown(e, di)}
            >
              {HOURS.map((h) => (
                <div key={h} {...stylex.props(styles.hourSlot)} data-bg="cell" />
              ))}

              {/* Busy events */}
              {busy
                .filter((b) => b.weekDay === di)
                .map((b, k) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: busy is a derived in-memory list with no stable id; index is unique within filter.
                    key={`busy-${di}-${k}`}
                    {...stylex.props(styles.busy)}
                    style={{
                      top: minutesToTopPx(b.startMin) + 1,
                      height: minutesToTopPx(b.endMin) - minutesToTopPx(b.startMin) - 2,
                    }}
                    data-testid="busy-event"
                  >
                    <span {...stylex.props(styles.busyTitle)}>{b.title ?? "予定"}</span>
                    <span>{formatRange(b.startMin, b.endMin)}</span>
                  </div>
                ))}

              {/* Candidate slots */}
              {liveCandidates
                .filter((c) => c.weekDay === di)
                .map((c) => (
                  // biome-ignore lint/a11y/noStaticElementInteractions: candidate slot is drag/resize/delete; keyboard alternative is the form mode (C-02)
                  <div
                    key={c.id}
                    {...stylex.props(styles.candidate)}
                    style={{
                      top: minutesToTopPx(c.startMin) + 1,
                      height: minutesToTopPx(c.endMin) - minutesToTopPx(c.startMin) - 2,
                    }}
                    data-testid={`candidate-${c.id}`}
                    onMouseDown={(e) => onCandidateMouseDown(e, c)}
                    onMouseEnter={() => setHoveredId(c.id)}
                    onMouseLeave={() => setHoveredId((curr) => (curr === c.id ? null : curr))}
                  >
                    <span {...stylex.props(styles.candidateLabel)}>候補時間</span>
                    <span>{formatRange(c.startMin, c.endMin)}</span>
                    {/* Resize handles */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: resize handle is pointer-only by design */}
                    <div
                      {...stylex.props(styles.resizeHandle, styles.resizeHandleTop)}
                      data-testid={`resize-top-${c.id}`}
                      role="presentation"
                      onMouseDown={(e) => onResizeMouseDown(e, c, "start")}
                    />
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: resize handle is pointer-only by design */}
                    <div
                      {...stylex.props(styles.resizeHandle, styles.resizeHandleBottom)}
                      data-testid={`resize-bottom-${c.id}`}
                      role="presentation"
                      onMouseDown={(e) => onResizeMouseDown(e, c, "end")}
                    />
                    {/* Delete X (visible on hover) */}
                    {hoveredId === c.id && (
                      <button
                        type="button"
                        {...stylex.props(styles.closeBtn)}
                        aria-label="候補時間を削除"
                        data-testid={`delete-${c.id}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCandidate(c.id);
                        }}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}

              {/* Live preview while creating */}
              {previewCandidate && previewCandidate.weekDay === di && (
                <div
                  {...stylex.props(
                    styles.preview,
                    previewCandidate.invalid && styles.candidateInvalid,
                  )}
                  style={{
                    top: minutesToTopPx(previewCandidate.startMin) + 1,
                    height:
                      minutesToTopPx(previewCandidate.endMin) -
                      minutesToTopPx(previewCandidate.startMin) -
                      2,
                    left: 4,
                    right: 4,
                  }}
                  data-testid="drag-preview"
                />
              )}
            </div>
          ))}

          {/* Tooltip while dragging */}
          {tooltip && (
            <div
              {...stylex.props(styles.tooltip)}
              style={{
                left: tooltip.x - gridOrigin.x + 14,
                top: tooltip.y - gridOrigin.y + 14,
              }}
            >
              <div {...stylex.props(styles.tooltipTitle)}>{tooltip.title}</div>
              <div>{tooltip.range}</div>
            </div>
          )}
        </div>
      </div>

      {/* Hint banner */}
      <div {...stylex.props(styles.hint)}>
        カレンダーをドラッグして候補時間を追加。既存の予定とは重ならない時間を自動で抽出します。
      </div>
    </div>
  );
}

// expose helpers for testing.
export const __testing = { snapToQuarterHour, formatRange, startOfWeekMonday, addDays };
