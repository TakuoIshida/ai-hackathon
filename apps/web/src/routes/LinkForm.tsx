import * as stylex from "@stylexjs/stylex";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth } from "@/auth";
import {
  type BusySlot,
  CalendarDragGrid,
  type CandidateSlot,
} from "@/components/availability-link/CalendarDragGrid";
import { LinkCreateLayout, type LinkMode } from "@/components/availability-link/LinkCreateLayout";
import { PublicationPeriodCard } from "@/components/availability-link/PublicationPeriodCard";
import { type LocationKind, SettingsPanel } from "@/components/availability-link/SettingsPanel";
import { WeekdayHoursEditor } from "@/components/availability-link/WeekdayHoursEditor";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api } from "@/lib/api";
import { DEFAULT_RANGE_DAYS, type LinkInput } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

const browserTimeZone =
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Tokyo";

/** Mock busy events for the calendar mode preview. ISH-245 では mock のみ。
 *  実 freebusy 連携は別 issue で BE schema 拡張と合わせて行う。 */
const MOCK_BUSY: BusySlot[] = [
  { weekDay: 0, startMin: 9 * 60, endMin: 10 * 60, title: "朝会" },
  { weekDay: 1, startMin: 13 * 60, endMin: 14 * 60, title: "1on1 / 田中" },
  { weekDay: 2, startMin: 10 * 60, endMin: 11 * 60 + 30, title: "デザインレビュー" },
  { weekDay: 3, startMin: 14 * 60, endMin: 15 * 60, title: "顧客MTG" },
  { weekDay: 4, startMin: 11 * 60, endMin: 12 * 60, title: "ランチ" },
  { weekDay: 4, startMin: 16 * 60, endMin: 17 * 60, title: "週次レビュー" },
];

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const offset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

const emptyInput: LinkInput = {
  slug: "",
  title: "",
  description: "",
  durationMinutes: 30,
  rangeDays: DEFAULT_RANGE_DAYS,
  timeZone: browserTimeZone,
  rules: [
    { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 5, startMinute: 9 * 60, endMinute: 17 * 60 },
  ],
};

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.lg },
  heading: {
    fontSize: typography.fontSizeXl,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
  },
  subheading: {
    fontSize: typography.fontSizeSm,
    color: colors.ink500,
    marginBlockStart: 0,
    marginBlockEnd: space.md,
  },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  caption: { fontSize: "0.8125rem", color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.8125rem" },
  hintBanner: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingBlock: "0.625rem",
    paddingInline: "0.875rem",
    backgroundColor: colors.blue50,
    border: `1px dashed ${colors.blue200}`,
    borderRadius: radius.lg,
    fontSize: typography.fontSizeXs,
    color: colors.blue800,
  },
  // ISH-245 (C-03): calendarPlaceholder は CalendarDragGrid に置き換わった
  // ので削除済み。
  // ISH-292: loading 状態 — 中央配置 Spinner で layout shift を抑える。
  loadingBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "240px",
  },
});

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function diffDays(fromStr: string, toStr: string): number | null {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).getTime();
  };
  const a = parse(fromStr);
  const b = parse(toStr);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
}

export default function LinkForm() {
  const navigate = useNavigate();
  const { getToken } = auth.useAuth();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<LinkInput>(emptyInput);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  // ISH-238 scaffolding: mode 切替の UI のみ実装。
  // ISH-245 (C-03): mode === 'calendar' で <CalendarDragGrid /> を render する。
  const [mode, setMode] = useState<LinkMode>("form");
  const [location, setLocation] = useState<LocationKind>("meet");
  // ISH-245 (C-03): calendar mode 用 state — form mode の rules とは別管理
  // (永続化は後続 issue)。
  const [calendarCandidates, setCalendarCandidates] = useState<CandidateSlot[]>([]);
  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() =>
    startOfWeekMonday(new Date()),
  );
  // ISH-244 (C-02): 公開期間 (form mode の "公開期間" card) — `from` は今日固定の派生値、
  // `to` は `from + form.rangeDays`。preset 押下で `rangeDays` を更新する。
  // schema 側は `rangeDays` のみ持つので、from/to は UI 表示用の derived state。
  const [periodFrom, setPeriodFrom] = useState<string>(() => todayLocal());
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const { link } = await api.getLink(id, () => getToken());
        if (cancelled) return;
        setForm({
          slug: link.slug,
          title: link.title,
          description: link.description ?? "",
          durationMinutes: link.durationMinutes,
          rangeDays: link.rangeDays,
          timeZone: link.timeZone,
          rules: link.rules,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  // slug uniqueness debounce
  useEffect(() => {
    if (isEdit) return; // edit mode tolerates current slug
    if (!/^[a-z0-9-]+$/.test(form.slug) || form.slug.length === 0) {
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const res = await api.checkSlugAvailable(form.slug, () => getToken());
        setSlugStatus(res.available ? "available" : "taken");
      } catch {
        setSlugStatus("idle");
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [form.slug, isEdit, getToken]);

  const onPatchForm = (patch: Partial<LinkInput>) => setForm((f) => ({ ...f, ...patch }));

  // 公開期間 derived: `to` = from + rangeDays。preset 押下で from/rangeDays を同時更新。
  const periodTo = addDays(periodFrom, form.rangeDays);
  const PERIOD_PRESETS = [7, 14, 30, 90];
  const activePeriodDays = PERIOD_PRESETS.includes(form.rangeDays) ? form.rangeDays : null;

  const onPeriodChange = ({
    from,
    to,
    activeDays,
  }: {
    from: string;
    to: string;
    activeDays: number | null;
  }) => {
    setPeriodFrom(from);
    if (activeDays !== null) {
      setForm((f) => ({ ...f, rangeDays: activeDays }));
    } else {
      const d = diffDays(from, to);
      if (d !== null && d >= 1 && d <= 365) {
        setForm((f) => ({ ...f, rangeDays: d }));
      }
    }
  };

  const submitNow = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit && id) {
        await api.updateLink(id, form, () => getToken());
      } else {
        await api.createLink(form, () => getToken());
      }
      navigate("/availability-sharings");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.status}: ${err.code}`);
      } else {
        setError("送信に失敗しました");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitNow();
  };

  const onPublishClick = () => {
    // Trigger native form validation (required attrs) before submitting via submitNow().
    const el = formRef.current;
    if (el && !el.reportValidity()) return;
    void submitNow();
  };

  const publishDisabled = submitting || slugStatus === "taken";

  if (loading) {
    return (
      <div {...stylex.props(styles.loadingBox)}>
        <Spinner size="lg" label="読み込み中" />
      </div>
    );
  }

  const settingsPanel = (
    <SettingsPanel
      form={form}
      onChange={onPatchForm}
      location={location}
      onLocationChange={setLocation}
      showAcceptanceSummary={mode === "form"}
    />
  );

  return (
    <LinkCreateLayout
      mode={mode}
      onModeChange={setMode}
      title={isEdit ? "編集" : "新規作成"}
      rightPanel={settingsPanel}
      rightPanelWidth={mode === "calendar" ? 380 : 460}
      onBack={() => navigate("/availability-sharings")}
      onPublish={onPublishClick}
      publishing={submitting}
      publishDisabled={publishDisabled}
    >
      <form ref={formRef} {...stylex.props(styles.body)} onSubmit={onFormSubmit}>
        {/* Basic info — slug + description + tz. タイトル / 所要時間 は SettingsPanel 側に移動済み。 */}
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>公開URL、説明、タイムゾーンを設定します。</CardDescription>
          </CardHeader>
          <CardBody>
            <div {...stylex.props(styles.field)}>
              <Label htmlFor="slug">スラッグ (URL)</Label>
              <Input
                id="slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="intro-30min"
                disabled={isEdit}
                required
              />
              <span {...stylex.props(styles.caption)}>
                {slugStatus === "checking" && "確認中..."}
                {slugStatus === "available" && "✓ 利用可能"}
                {slugStatus === "taken" && (
                  <span {...stylex.props(styles.error)}>このスラッグは使用済みです</span>
                )}
              </span>
            </div>
            <div {...stylex.props(styles.field)}>
              <Label htmlFor="description">説明（任意）</Label>
              <Input
                id="description"
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div {...stylex.props(styles.field)}>
              <Label htmlFor="tz">タイムゾーン</Label>
              <Input
                id="tz"
                value={form.timeZone}
                onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
              />
            </div>
          </CardBody>
        </Card>

        {mode === "calendar" ? (
          // ISH-245 (C-03): カレンダードラッグ mode 本体。
          // 永続化は後続 issue で対応 (BE schema 拡張が必要)。busy は mock。
          <CalendarDragGrid
            candidates={calendarCandidates}
            busy={MOCK_BUSY}
            onCandidatesChange={setCalendarCandidates}
            weekStart={calendarWeekStart}
            onWeekChange={setCalendarWeekStart}
          />
        ) : (
          <>
            <h2 {...stylex.props(styles.heading)}>受付可能な時間帯を指定</h2>
            <p {...stylex.props(styles.subheading)}>
              曜日ごとに受付時間を設定します。既存予定との重なりは自動で除外されます。
            </p>

            <PublicationPeriodCard
              from={periodFrom}
              to={periodTo}
              activeDays={activePeriodDays}
              onChange={onPeriodChange}
            />

            <WeekdayHoursEditor
              rules={form.rules}
              onChange={(rules) => setForm((f) => ({ ...f, rules }))}
            />

            <div {...stylex.props(styles.hintBanner)}>
              <Info size={15} aria-hidden="true" color={colors.blue600} />
              連携カレンダーの予定を確認し、自動で衝突を除外します
            </div>
          </>
        )}

        {error && <p {...stylex.props(styles.error)}>{error}</p>}

        {/* hidden submit so the form retains native submit semantics. The visible
            "リンクを発行" button (in subnav) calls submitNow() directly. */}
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </form>
    </LinkCreateLayout>
  );
}
