/**
 * /invite/:token/setup-calendar — Setup-complete 画面 (ISH-242 / O-03)
 *
 * 招待受諾 → Google OAuth 完了後に表示される最終ステップ。
 * Spir 既存仕様の Artboard 9 (`/tmp/spir-design/artboards/setup-complete.jsx`)
 * を踏襲した 2-column layout (左: stepper + radio + callout + CTA / 右:
 * gradient + mini calendar preview)。
 *
 * 実装方針:
 *  - Google Calendar list API は実装フェーズ未着手。本 route は **mock データ**
 *    のみで動作させる (3 件固定: メイン / 仕事用 / 個人イベント)。
 *  - `<auth.SignedIn>` ガード越しに描画する (未サインインは /sign-in へ送る)。
 *  - 「セットアップを完了」ボタンで /availability-sharings へ遷移。AcceptInvite
 *    の成功遷移先と一致させ、O-02 → O-03 経由でも結局同じランディングに
 *    着くようにする。
 *
 * mini calendar preview は static 実装。今日 (`new Date()`) の週 (Mon〜Sun)
 * を 7 日表示し、今日のセルだけハイライトする。月日ナビボタンは見せかけで
 * 何もしない (artboard と同じ)。
 */
import * as stylex from "@stylexjs/stylex";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Stepper } from "@/components/ui/stepper";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

// ---------------------------------------------------------------------------
// Stepper steps — O-01 〜 O-03 共通の 4-step 定義。本画面は current=2
// (カレンダー連携 step が active)。
// ---------------------------------------------------------------------------
const STEPS = [
  { label: "招待を確認" },
  { label: "Googleでログイン" },
  { label: "カレンダー連携" },
  { label: "完了" },
] as const;

// ---------------------------------------------------------------------------
// Calendar list — 実 API 未連携のため mock。Google Calendar list の typical な
// レスポンス形 (id / summary / backgroundColor / primary) を踏襲した形にして
// おくと、後続 issue で API 差し替えが楽になる。
// ---------------------------------------------------------------------------
type CalendarOption = {
  id: string;
  name: string;
  label: string;
  color: string;
};

const MOCK_CALENDARS: ReadonlyArray<CalendarOption> = [
  {
    id: "primary",
    name: "suzuki@team.example.com",
    label: "メイン (Google Calendar)",
    color: "#1A73E8",
  },
  { id: "work", name: "仕事用カレンダー", label: "Google Calendar", color: "#33B679" },
  { id: "personal", name: "個人イベント", label: "Google Calendar", color: "#D9695F" },
];

// ---------------------------------------------------------------------------
// Mini calendar — 今日を含む週 (Mon〜Sun) の 7 日を返す。月初をまたぐと番号が
// 不揃いになるが、artboard 通り日付数値のみを表示するのでその挙動は許容。
// ---------------------------------------------------------------------------
type WeekDay = {
  /** YYYY-MM-DD 形式 — React key 用の一意な ID。 */
  isoDate: string;
  date: number;
  isToday: boolean;
  isWeekend: boolean;
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildWeek(today: Date): {
  rangeLabel: string;
  days: ReadonlyArray<WeekDay>;
} {
  // JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat。月曜始まりに揃える。
  const dayOfWeek = today.getDay();
  const offsetToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offsetToMon);
  const todayIso = toIsoDate(today);
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const isoDate = toIsoDate(d);
    days.push({
      isoDate,
      date: d.getDate(),
      isToday: isoDate === todayIso,
      // Sat (i=5) と Sun (i=6) を週末扱い。artboard は日曜のみ赤だが、
      // `isWeekend` は将来の柔軟性のために土日両方を持っておく。
      isWeekend: i >= 5,
    });
  }
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const rangeLabel = `${monday.getMonth() + 1}月 ${monday.getDate()}日 — ${sunday.getDate()}日`;
  return { rangeLabel, days };
}

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------
const styles = stylex.create({
  root: {
    minHeight: "100dvh",
    backgroundColor: "#ffffff",
    color: colors.fg,
    display: "flex",
    flexDirection: "column",
    fontFamily: typography.fontFamilySans,
  },
  topBar: {
    height: "4rem",
    borderBottom: `1px solid ${colors.ink200}`,
    display: "flex",
    alignItems: "center",
    paddingInline: space.xl,
    flexShrink: 0,
  },
  // 2-column grid (1fr 1fr) — artboard 通り。狭いビューポートでは縦積みに。
  body: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: { default: "1fr", "@media (min-width: 1024px)": "1fr 1fr" },
    overflow: "hidden",
  },
  leftColumn: {
    paddingBlock: { default: space.xl, "@media (min-width: 1024px)": "3.75rem" },
    paddingInline: { default: space.lg, "@media (min-width: 1024px)": "5rem" },
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  stepperRow: {
    marginBottom: "1.75rem",
  },
  heading: {
    fontSize: "1.75rem", // 28px
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
    marginBottom: space.sm,
    letterSpacing: "-0.01em",
    lineHeight: typography.lineHeightTight,
  },
  description: {
    fontSize: typography.fontSizeSm,
    color: colors.ink700,
    margin: 0,
    marginBottom: "1.75rem",
    lineHeight: 1.7,
  },
  // RadioGroup wrapper override — gap を 10px に詰めて artboard に寄せる。
  radioList: {
    gap: "0.625rem",
    marginBottom: space.lg,
  },
  radioRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.875rem 1rem",
    borderRadius: "0.625rem",
    cursor: "pointer",
    backgroundColor: "#ffffff",
    borderWidth: "1.5px",
    borderStyle: "solid",
    borderColor: colors.ink200,
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
  },
  radioRowSelected: {
    borderColor: colors.blue500,
    backgroundColor: colors.blue50,
  },
  // Color swatch (artboard の 12×12px の正方形) — calendar 識別の視覚的キュー。
  colorChip: {
    width: "0.75rem",
    height: "0.75rem",
    borderRadius: "0.1875rem",
    flexShrink: 0,
  },
  rowMeta: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.125rem",
    minWidth: 0,
  },
  rowName: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowLabel: {
    fontSize: "0.6875rem",
    color: colors.ink500,
  },
  selectedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    fontSize: "0.6875rem",
    fontWeight: typography.fontWeightBold,
    color: colors.blue700,
    backgroundColor: "#ffffff",
    border: `1px solid ${colors.blue200}`,
    borderRadius: radius.sm,
    paddingInline: "0.5rem",
    paddingBlock: "0.1875rem",
    flexShrink: 0,
  },
  // Mint success callout — artboard の "Googleカレンダーの連携が完了しました"。
  callout: {
    backgroundColor: colors.mint100,
    border: "1px solid #B5DCC9",
    borderRadius: "0.625rem",
    padding: "0.875rem 1rem",
    display: "flex",
    gap: "0.75rem",
    alignItems: "flex-start",
    marginBottom: space.lg,
  },
  calloutText: {
    fontSize: "0.8125rem",
    color: "#235943",
    lineHeight: 1.6,
    display: "flex",
    flexDirection: "column",
    gap: "0.125rem",
  },
  calloutTitle: {
    fontWeight: typography.fontWeightBold,
  },
  calloutSub: {
    fontSize: typography.fontSizeXs,
  },
  // CTA は alignSelf: flex-start で artboard と揃える。
  ctaRow: {
    display: "flex",
  },
  // 右ペイン: blue gradient + dot pattern + 中央に white card。
  rightColumn: {
    display: { default: "none", "@media (min-width: 1024px)": "grid" },
    placeItems: "center",
    backgroundImage: `linear-gradient(160deg, ${colors.blue50} 0%, ${colors.blue100} 50%, #F4ECF4 100%)`,
    position: "relative",
    overflow: "hidden",
  },
  dotPattern: {
    position: "absolute",
    inset: 0,
    opacity: 0.25,
    backgroundImage: `radial-gradient(${colors.ink300} 1px, transparent 1px)`,
    backgroundSize: "16px 16px",
  },
  miniCard: {
    position: "relative",
    width: "23.75rem", // 380px
    backgroundColor: "#ffffff",
    borderRadius: "1rem",
    boxShadow: shadow.lg,
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
  },
  miniHeader: {
    display: "flex",
    alignItems: "center",
    marginBottom: "0.875rem",
  },
  miniRangeLabel: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  miniNav: {
    marginLeft: "auto",
    display: "flex",
    gap: "0.25rem",
  },
  miniIconBtn: {
    width: "1.625rem",
    height: "1.625rem",
    display: "grid",
    placeItems: "center",
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.sm,
    backgroundColor: "#ffffff",
    color: colors.ink500,
    cursor: "pointer",
  },
  miniWeekdays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "0.25rem",
    marginBottom: "0.5rem",
  },
  miniWeekday: {
    textAlign: "center",
    fontSize: "0.625rem",
    color: colors.ink500,
  },
  miniWeekdayWeekendSun: {
    color: colors.rose500,
  },
  miniDays: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: "0.25rem",
  },
  miniDay: {
    aspectRatio: "1",
    display: "grid",
    placeItems: "center",
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    borderRadius: "0.375rem",
  },
  miniDayToday: {
    backgroundColor: colors.blue600,
    color: "#ffffff",
  },
  miniInfoBox: {
    marginTop: space.md,
    padding: "0.625rem 0.75rem",
    backgroundColor: colors.blue50,
    border: `1px solid ${colors.blue150}`,
    borderRadius: radius.md,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  miniInfoText: {
    fontSize: "0.6875rem",
    color: colors.blue900,
  },
});

// ---------------------------------------------------------------------------
// Sub-component: 1 つの calendar 行 (radio + color chip + label + badge)。
// ---------------------------------------------------------------------------
function CalendarRow({ calendar, selected }: { calendar: CalendarOption; selected: boolean }) {
  return (
    <label
      htmlFor={`cal-${calendar.id}`}
      {...stylex.props(styles.radioRow, selected && styles.radioRowSelected)}
    >
      <RadioGroupItem id={`cal-${calendar.id}`} value={calendar.id} aria-label={calendar.name} />
      <span
        aria-hidden="true"
        {...stylex.props(styles.colorChip)}
        style={{ backgroundColor: calendar.color }}
      />
      <div {...stylex.props(styles.rowMeta)}>
        <div {...stylex.props(styles.rowName)}>{calendar.name}</div>
        <div {...stylex.props(styles.rowLabel)}>{calendar.label}</div>
      </div>
      {selected && (
        <span aria-hidden="true" {...stylex.props(styles.selectedBadge)}>
          <CheckCircle2 size={11} /> 登録先
        </span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Inner component (assumes signed-in)。
// ---------------------------------------------------------------------------
function SetupCompleteForm() {
  const navigate = useNavigate();
  // primary をデフォルト選択。RadioGroup は controlled で持つ (テストで切替を
  // 観察するため)。
  const [selected, setSelected] = React.useState<string>(MOCK_CALENDARS[0].id);
  // `new Date()` を毎 render 呼ぶと無駄な再計算になるので memo。
  const week = React.useMemo(() => buildWeek(new Date()), []);

  function onComplete() {
    navigate("/availability-sharings", { replace: true });
  }

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.topBar)}>
        <Logo size="md" />
      </div>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.leftColumn)}>
          <div {...stylex.props(styles.stepperRow)}>
            <Stepper steps={[...STEPS]} current={2} />
          </div>
          <h1 {...stylex.props(styles.heading)}>予定を登録するカレンダーを選択</h1>
          <p {...stylex.props(styles.description)}>
            Ripsで確定した予定の登録先となるカレンダーを選んでください。あとから変更できます。
          </p>
          <RadioGroup
            value={selected}
            onValueChange={setSelected}
            aria-label="登録先カレンダー"
            {...stylex.props(styles.radioList)}
          >
            {MOCK_CALENDARS.map((c) => (
              <CalendarRow key={c.id} calendar={c} selected={c.id === selected} />
            ))}
          </RadioGroup>
          <div role="status" {...stylex.props(styles.callout)}>
            <CheckCircle2
              size={18}
              color={colors.mint500}
              style={{ marginTop: 1, flexShrink: 0 }}
            />
            <div {...stylex.props(styles.calloutText)}>
              <span {...stylex.props(styles.calloutTitle)}>
                Googleカレンダーの連携が完了しました
              </span>
              <span {...stylex.props(styles.calloutSub)}>
                {MOCK_CALENDARS.length}件のカレンダーから空き時間を自動検出します
              </span>
            </div>
          </div>
          <div {...stylex.props(styles.ctaRow)}>
            <Button
              type="button"
              size="lg"
              onClick={onComplete}
              rightIcon={<ChevronRight size={16} />}
            >
              セットアップを完了
            </Button>
          </div>
        </div>

        <div {...stylex.props(styles.rightColumn)} aria-hidden="true">
          <span {...stylex.props(styles.dotPattern)} />
          <div {...stylex.props(styles.miniCard)} data-testid="mini-calendar-preview">
            <div {...stylex.props(styles.miniHeader)}>
              <div {...stylex.props(styles.miniRangeLabel)}>{week.rangeLabel}</div>
              <div {...stylex.props(styles.miniNav)}>
                <button
                  type="button"
                  {...stylex.props(styles.miniIconBtn)}
                  aria-label="前の週"
                  tabIndex={-1}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  {...stylex.props(styles.miniIconBtn)}
                  aria-label="次の週"
                  tabIndex={-1}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div {...stylex.props(styles.miniWeekdays)}>
              {WEEKDAY_LABELS.map((d, i) => (
                <div
                  key={d}
                  {...stylex.props(styles.miniWeekday, i === 6 && styles.miniWeekdayWeekendSun)}
                >
                  {d}
                </div>
              ))}
            </div>
            <div {...stylex.props(styles.miniDays)}>
              {week.days.map((d) => (
                <div
                  // ISO 日付は週内で必ず一意なので React key として安全。
                  key={d.isoDate}
                  {...stylex.props(styles.miniDay, d.isToday && styles.miniDayToday)}
                  data-today={d.isToday || undefined}
                >
                  {d.date}
                </div>
              ))}
            </div>
            <div {...stylex.props(styles.miniInfoBox)}>
              <Clock size={14} color={colors.blue600} />
              <div {...stylex.props(styles.miniInfoText)}>
                本日 14:00 から空き時間が利用可能です
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth gate — 未サインインは /sign-in へ送る。Onboarding と同じパターン。
// ---------------------------------------------------------------------------
export default function SetupComplete() {
  const { isLoaded, isSignedIn } = auth.useAuth();
  // SDK ロード完了前は何も描画しない (sign-in へ flash redirect しないため)。
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <SetupCompleteForm />;
}
