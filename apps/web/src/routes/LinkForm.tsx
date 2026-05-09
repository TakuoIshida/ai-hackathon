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
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { DEFAULT_RANGE_DAYS, type LinkInput } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/** Mock busy events for the calendar mode preview.
 *  TODO(ISH-296 E / 別 issue): BE freebusy 連携。今は mock のみ。
 *  実装は GooglePort.getFreeBusy を /links/{id}/freebusy 等で参照する形を想定。 */
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

// ISH-296 (C): TZ は MVP では Asia/Tokyo 固定。UI から非表示。BE schema は
// `timeZone` を引き続き受領するので将来的な拡張余地は残す。
const FIXED_TIME_ZONE = "Asia/Tokyo";

const emptyInput: LinkInput = {
  // ISH-296 (B): slug は BE 側で auto-generate される。FE は空のまま渡し、
  // request payload からは `slug` を落として送る。
  slug: "",
  title: "",
  description: "",
  durationMinutes: 30,
  rangeDays: DEFAULT_RANGE_DAYS,
  timeZone: FIXED_TIME_ZONE,
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

/**
 * ISH-296 (B/C/D): create / update payload を組み立てる。
 *  - slug は FE が空のまま渡してきても BE が auto-generate するよう undefined で送る
 *  - timeZone は FIXED_TIME_ZONE で送る (UI 非表示)
 *  - description が空文字なら null に正規化
 *  - ISH-298 で削除済みフィールドは元から含めない (LinkInput type からも削除済み)
 */
function buildLinkPayload(form: LinkInput): Omit<LinkInput, "slug"> & { slug?: string } {
  const payload: Omit<LinkInput, "slug"> & { slug?: string } = {
    title: form.title,
    description: form.description?.length ? form.description : null,
    durationMinutes: form.durationMinutes,
    rangeDays: form.rangeDays,
    timeZone: FIXED_TIME_ZONE,
    rules: form.rules,
  };
  if (form.slug && form.slug.length > 0) payload.slug = form.slug;
  return payload;
}

export default function LinkForm() {
  const navigate = useNavigate();
  const { getToken } = auth.useAuth();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<LinkInput>(emptyInput);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  /**
   * ISH-296 (D) + ISH-297: 共通 submit。
   *  - publish: 成功で /availability-sharings に navigate
   *  - draft: 成功で同ページに留まり toast 表示。新規作成時は /availability-sharings/{id}/edit
   *           に置換 navigate して edit mode に切り替える (以後の draft 保存は update に乗る)。
   */
  const submitNow = async (intent: "publish" | "draft" = "publish") => {
    setError(null);
    setSubmitting(true);
    try {
      const payload = buildLinkPayload(form);
      if (isEdit && id) {
        await api.updateLink(id, payload, () => getToken());
      } else {
        const { link } = await api.createLink(payload as LinkInput, () => getToken());
        if (intent === "draft") {
          // 新規 → 作成成功後 edit 画面へ。stay-in-place な感覚を維持しつつ
          // 以後の draft 保存は update API に乗るようにする。
          setForm({
            slug: link.slug,
            title: link.title,
            description: link.description ?? "",
            durationMinutes: link.durationMinutes,
            rangeDays: link.rangeDays,
            timeZone: link.timeZone,
            rules: link.rules,
          });
          navigate(`/availability-sharings/${link.id}/edit`, { replace: true });
        }
      }
      if (intent === "draft") {
        toast({ title: "下書きを保存しました", variant: "success" });
      } else {
        navigate("/availability-sharings");
      }
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
    await submitNow("publish");
  };

  const onPublishClick = () => {
    // Trigger native form validation (required attrs) before submitting via submitNow().
    const el = formRef.current;
    if (el && !el.reportValidity()) return;
    void submitNow("publish");
  };

  // ISH-297: 下書き保存。required validation だけ通せば draft でも提出できる。
  const onSaveDraftClick = () => {
    const el = formRef.current;
    if (el && !el.reportValidity()) return;
    void submitNow("draft");
  };

  const publishDisabled = submitting;

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
      onSaveDraft={onSaveDraftClick}
      publishing={submitting}
      publishDisabled={publishDisabled}
    >
      <form ref={formRef} {...stylex.props(styles.body)} onSubmit={onFormSubmit}>
        {/* ISH-296 (B/C): slug + tz は FE から削除。slug は BE 自動生成、tz は Asia/Tokyo 固定。
            残るのは説明欄のみ。 */}
        <Card>
          <CardHeader>
            <CardTitle>基本情報</CardTitle>
            <CardDescription>説明文を任意で設定できます。</CardDescription>
          </CardHeader>
          <CardBody>
            <div {...stylex.props(styles.field)}>
              <Label htmlFor="description">説明（任意）</Label>
              <Input
                id="description"
                value={form.description ?? ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
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
