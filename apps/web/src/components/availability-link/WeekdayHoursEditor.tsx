import * as stylex from "@stylexjs/stylex";
import { Copy, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { AvailabilityRule, Weekday } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * 曜日 × 受付時間帯 editor — 7行 (月〜日) で各 weekday の受付時間帯を編集する。
 *
 * - データ表現: `LinkInput.rules` (複数 range 可、同一 weekday 複数 entry で表現)
 * - on/off: その weekday の rule が 0 件 = off, 1件以上 = on
 * - on/off toggle: off → on で 09:00-17:00 のデフォルト range を 1 件追加
 * - "+追加" で同 weekday の range を追加 (last-end〜last-end+1h, fallback 09:00-17:00)
 * - "✕" で個別 range 削除 (最後の 1 件を削除しても off にはならず empty 状態を維持。
 *    ただし API で empty rules array を許容するため OK)
 * - "平日に一括適用" で月の ranges を火〜金に複製
 *
 * 行は keyed by weekday (1〜7 の固定数なので index key で問題無し)。
 * ranges 内の key は「同じ weekday の中での出現順 index」。
 */

const WEEKDAYS: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5, 6, 0];

const DEFAULT_START_MIN = 9 * 60;
const DEFAULT_END_MIN = 17 * 60;

export interface WeekdayHoursEditorProps {
  /** Current rules array (sorted/order is irrelevant; component groups by weekday). */
  rules: ReadonlyArray<AvailabilityRule>;
  /** Replace the rules array. */
  onChange: (next: AvailabilityRule[]) => void;
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Group rules by weekday into ordered ranges-per-weekday. */
function groupByWeekday(
  rules: ReadonlyArray<AvailabilityRule>,
): Record<Weekday, Array<{ startMinute: number; endMinute: number }>> {
  const out: Record<Weekday, Array<{ startMinute: number; endMinute: number }>> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };
  for (const r of rules) {
    const wd = r.weekday as Weekday;
    out[wd].push({ startMinute: r.startMinute, endMinute: r.endMinute });
  }
  return out;
}

/** Flatten the grouped map back to a flat rules array. */
function ungroup(
  grouped: Record<Weekday, Array<{ startMinute: number; endMinute: number }>>,
): AvailabilityRule[] {
  const out: AvailabilityRule[] = [];
  for (const wd of WEEKDAYS) {
    for (const r of grouped[wd]) {
      out.push({ weekday: wd, startMinute: r.startMinute, endMinute: r.endMinute });
    }
  }
  return out;
}

const styles = stylex.create({
  card: {
    backgroundColor: colors.bg,
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.lg,
    padding: "1.125rem",
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
  },
  title: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
  },
  bulkBtn: {
    marginInlineStart: "auto",
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "60px 50px 1fr auto",
    alignItems: "start",
    gap: "0.75rem",
    paddingBlockEnd: "0.75rem",
    borderBlockEnd: `1px solid ${colors.ink100}`,
  },
  rowLast: {
    borderBlockEnd: "none",
    paddingBlockEnd: 0,
  },
  toggleCell: {
    paddingBlockStart: "0.5rem",
  },
  dayLabel: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    paddingBlockStart: "0.5rem",
  },
  dayLabelOn: {
    color: colors.blue900,
  },
  dayLabelOff: {
    color: colors.ink400,
  },
  rangesCol: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  rangeRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  timeInputBox: {
    width: "6rem",
  },
  separator: {
    color: colors.ink400,
  },
  iconBtn: {
    width: "1.75rem",
    height: "1.75rem",
    borderRadius: radius.md,
    border: `1px solid ${colors.ink200}`,
    backgroundColor: colors.bg,
    color: colors.ink500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  emptyText: {
    fontSize: typography.fontSizeSm,
    color: colors.ink400,
    paddingBlockStart: "0.5rem",
  },
  actionCell: {
    paddingBlockStart: "0.25rem",
  },
});

export function WeekdayHoursEditor({ rules, onChange }: WeekdayHoursEditorProps) {
  const grouped = groupByWeekday(rules);

  const update = (next: Record<Weekday, Array<{ startMinute: number; endMinute: number }>>) =>
    onChange(ungroup(next));

  const cloneGrouped = () => {
    const copy: Record<Weekday, Array<{ startMinute: number; endMinute: number }>> = {
      0: [...grouped[0]],
      1: [...grouped[1]],
      2: [...grouped[2]],
      3: [...grouped[3]],
      4: [...grouped[4]],
      5: [...grouped[5]],
      6: [...grouped[6]],
    };
    return copy;
  };

  const toggleWeekday = (wd: Weekday) => {
    const next = cloneGrouped();
    if (next[wd].length > 0) {
      next[wd] = [];
    } else {
      next[wd] = [{ startMinute: DEFAULT_START_MIN, endMinute: DEFAULT_END_MIN }];
    }
    update(next);
  };

  const addRange = (wd: Weekday) => {
    const next = cloneGrouped();
    const last = next[wd][next[wd].length - 1];
    const start = last ? Math.min(last.endMinute, 23 * 60) : DEFAULT_START_MIN;
    const end = Math.min(start + 60, 24 * 60);
    next[wd] = [...next[wd], { startMinute: start, endMinute: end }];
    update(next);
  };

  const removeRange = (wd: Weekday, idx: number) => {
    const next = cloneGrouped();
    next[wd] = next[wd].filter((_, i) => i !== idx);
    update(next);
  };

  const setRangeTime = (
    wd: Weekday,
    idx: number,
    patch: Partial<{ startMinute: number; endMinute: number }>,
  ) => {
    const next = cloneGrouped();
    next[wd] = next[wd].map((r, i) => (i === idx ? { ...r, ...patch } : r));
    update(next);
  };

  const applyMondayToWeekdays = () => {
    const monday = grouped[1];
    const next = cloneGrouped();
    for (const wd of [2, 3, 4, 5] as const) {
      next[wd] = monday.map((r) => ({ ...r }));
    }
    update(next);
  };

  return (
    <section {...stylex.props(styles.card)} aria-label="受付時間帯">
      <div {...stylex.props(styles.header)}>
        <h3 {...stylex.props(styles.title)}>受付時間帯</h3>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={applyMondayToWeekdays}
          leftIcon={<Copy size={13} aria-hidden="true" />}
          {...stylex.props(styles.bulkBtn)}
        >
          平日に一括適用
        </Button>
      </div>
      <div {...stylex.props(styles.rows)}>
        {WEEKDAYS.map((wd, idx) => {
          const ranges = grouped[wd];
          const on = ranges.length > 0;
          const isLast = idx === WEEKDAYS.length - 1;
          const rowSx = stylex.props(styles.row, isLast && styles.rowLast);
          return (
            <div key={wd} className={rowSx.className} style={rowSx.style}>
              <div {...stylex.props(styles.toggleCell)}>
                <Switch
                  checked={on}
                  onCheckedChange={() => toggleWeekday(wd)}
                  aria-label={`${WEEKDAY_LABELS[wd]}曜日 受付`}
                />
              </div>
              <div {...stylex.props(styles.dayLabel, on ? styles.dayLabelOn : styles.dayLabelOff)}>
                {WEEKDAY_LABELS[wd]}
              </div>
              <div {...stylex.props(styles.rangesCol)}>
                {on ? (
                  ranges.map((r, i) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: ranges within a single weekday are an ordered list with no stable id; index is fine for ephemeral keys.
                      key={i}
                      {...stylex.props(styles.rangeRow)}
                    >
                      <span {...stylex.props(styles.timeInputBox)}>
                        <Input
                          type="time"
                          aria-label={`${WEEKDAY_LABELS[wd]}曜日 ${i + 1}番目 開始時刻`}
                          value={formatTime(r.startMinute)}
                          onChange={(e) => {
                            const m = parseTime(e.target.value);
                            if (m !== null) setRangeTime(wd, i, { startMinute: m });
                          }}
                        />
                      </span>
                      <span {...stylex.props(styles.separator)} aria-hidden="true">
                        –
                      </span>
                      <span {...stylex.props(styles.timeInputBox)}>
                        <Input
                          type="time"
                          aria-label={`${WEEKDAY_LABELS[wd]}曜日 ${i + 1}番目 終了時刻`}
                          value={formatTime(r.endMinute)}
                          onChange={(e) => {
                            const m = parseTime(e.target.value);
                            if (m !== null) setRangeTime(wd, i, { endMinute: m });
                          }}
                        />
                      </span>
                      <button
                        type="button"
                        aria-label={`${WEEKDAY_LABELS[wd]}曜日 ${i + 1}番目 削除`}
                        onClick={() => removeRange(wd, i)}
                        {...stylex.props(styles.iconBtn)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : (
                  <span {...stylex.props(styles.emptyText)}>受付なし</span>
                )}
              </div>
              <div {...stylex.props(styles.actionCell)}>
                {on && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => addRange(wd)}
                    leftIcon={<Plus size={13} aria-hidden="true" />}
                  >
                    追加
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
