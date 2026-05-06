import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth } from "@/auth";
import {
  type BusySlot,
  CalendarDragGrid,
  type CandidateSlot,
} from "@/components/availability-link/CalendarDragGrid";
import { LinkCreateLayout, type LinkMode } from "@/components/availability-link/LinkCreateLayout";
import { type LocationKind, SettingsPanel } from "@/components/availability-link/SettingsPanel";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import {
  BUFFER_CHOICES,
  DEFAULT_RANGE_DAYS,
  type LinkInput,
  SLOT_INTERVAL_CHOICES,
  WEEKDAY_LABELS,
  type Weekday,
} from "@/lib/types";
import { colors, space, typography } from "@/styles/tokens.stylex";

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
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  slotIntervalMinutes: null,
  maxPerDay: null,
  leadTimeHours: 0,
  rangeDays: DEFAULT_RANGE_DAYS,
  timeZone: browserTimeZone,
  isPublished: false,
  rules: [
    { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 2, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 3, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 4, startMinute: 9 * 60, endMinute: 17 * 60 },
    { weekday: 5, startMinute: 9 * 60, endMinute: 17 * 60 },
  ],
  excludes: [],
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
  fieldRow: { display: "flex", gap: space.md, flexWrap: "wrap" },
  fieldHalf: { flex: "1 1 12rem", display: "flex", flexDirection: "column", gap: space.xs },
  caption: { fontSize: "0.8125rem", color: colors.muted },
  weekdayRow: {
    display: "grid",
    gridTemplateColumns: "3rem 1fr 1fr auto",
    gap: space.sm,
    alignItems: "center",
  },
  excludeRow: { display: "flex", gap: space.sm, alignItems: "center" },
  toggle: { display: "flex", alignItems: "center", gap: space.sm },
  error: { color: colors.destructive, fontSize: "0.8125rem" },
});

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

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
  // calendar mode 用 state — form mode の rules とは別管理 (永続化は後続 issue)。
  const [calendarCandidates, setCalendarCandidates] = useState<CandidateSlot[]>([]);
  const [calendarWeekStart, setCalendarWeekStart] = useState<Date>(() =>
    startOfWeekMonday(new Date()),
  );
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
          bufferBeforeMinutes: link.bufferBeforeMinutes,
          bufferAfterMinutes: link.bufferAfterMinutes,
          slotIntervalMinutes: link.slotIntervalMinutes,
          maxPerDay: link.maxPerDay,
          leadTimeHours: link.leadTimeHours,
          rangeDays: link.rangeDays,
          timeZone: link.timeZone,
          isPublished: link.isPublished,
          rules: link.rules,
          excludes: link.excludes,
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

  const setRule = (
    weekday: Weekday,
    patch: Partial<{ startMinute: number; endMinute: number }>,
  ) => {
    setForm((f) => ({
      ...f,
      rules: f.rules.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)),
    }));
  };

  const toggleWeekday = (weekday: Weekday) => {
    setForm((f) => {
      const has = f.rules.some((r) => r.weekday === weekday);
      if (has) return { ...f, rules: f.rules.filter((r) => r.weekday !== weekday) };
      return {
        ...f,
        rules: [...f.rules, { weekday, startMinute: 9 * 60, endMinute: 17 * 60 }].sort(
          (a, b) => a.weekday - b.weekday,
        ),
      };
    });
  };

  const onPatchForm = (patch: Partial<LinkInput>) => setForm((f) => ({ ...f, ...patch }));

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

  if (loading) return <p>読み込み中...</p>;

  const settingsPanel = (
    <SettingsPanel
      form={form}
      onChange={onPatchForm}
      location={location}
      onLocationChange={setLocation}
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

            <Card>
              <CardHeader>
                <CardTitle>営業時間</CardTitle>
                <CardDescription>曜日ごとに受付時間帯を設定します。</CardDescription>
              </CardHeader>
              <CardBody>
                {WEEKDAYS.map((wd) => {
                  const rule = form.rules.find((r) => r.weekday === wd);
                  return (
                    <div key={wd} {...stylex.props(styles.weekdayRow)}>
                      <label {...stylex.props(styles.toggle)}>
                        <input
                          type="checkbox"
                          checked={Boolean(rule)}
                          onChange={() => toggleWeekday(wd)}
                        />
                        {WEEKDAY_LABELS[wd]}
                      </label>
                      <Input
                        type="time"
                        disabled={!rule}
                        value={rule ? formatTime(rule.startMinute) : "09:00"}
                        onChange={(e) => {
                          const m = parseTime(e.target.value);
                          if (m !== null) setRule(wd, { startMinute: m });
                        }}
                      />
                      <Input
                        type="time"
                        disabled={!rule}
                        value={rule ? formatTime(rule.endMinute) : "17:00"}
                        onChange={(e) => {
                          const m = parseTime(e.target.value);
                          if (m !== null) setRule(wd, { endMinute: m });
                        }}
                      />
                      <span />
                    </div>
                  );
                })}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>スロット設定</CardTitle>
                <CardDescription>
                  前後バッファ・開始間隔・1日の上限・受付期間を設定できます。
                </CardDescription>
              </CardHeader>
              <CardBody>
                <div {...stylex.props(styles.fieldRow)}>
                  <div {...stylex.props(styles.fieldHalf)}>
                    <Label htmlFor="bbefore">前バッファ</Label>
                    <select
                      id="bbefore"
                      value={form.bufferBeforeMinutes}
                      onChange={(e) =>
                        setForm({ ...form, bufferBeforeMinutes: Number(e.target.value) })
                      }
                    >
                      {BUFFER_CHOICES.map((b) => (
                        <option key={b} value={b}>
                          {b} 分
                        </option>
                      ))}
                    </select>
                  </div>
                  <div {...stylex.props(styles.fieldHalf)}>
                    <Label htmlFor="bafter">後バッファ</Label>
                    <select
                      id="bafter"
                      value={form.bufferAfterMinutes}
                      onChange={(e) =>
                        setForm({ ...form, bufferAfterMinutes: Number(e.target.value) })
                      }
                    >
                      {BUFFER_CHOICES.map((b) => (
                        <option key={b} value={b}>
                          {b} 分
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div {...stylex.props(styles.fieldRow)}>
                  <div {...stylex.props(styles.fieldHalf)}>
                    <Label htmlFor="interval">開始間隔</Label>
                    <select
                      id="interval"
                      value={form.slotIntervalMinutes ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          slotIntervalMinutes:
                            e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    >
                      <option value="">duration に揃える</option>
                      {SLOT_INTERVAL_CHOICES.map((m) => (
                        <option key={m} value={m}>
                          {m} 分
                        </option>
                      ))}
                    </select>
                  </div>
                  <div {...stylex.props(styles.fieldHalf)}>
                    <Label htmlFor="maxPerDay">1日の上限</Label>
                    <Input
                      id="maxPerDay"
                      type="number"
                      min={1}
                      value={form.maxPerDay ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          maxPerDay: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="無制限"
                    />
                  </div>
                </div>
                <div {...stylex.props(styles.fieldRow)}>
                  <div {...stylex.props(styles.fieldHalf)}>
                    <Label htmlFor="lead">受付開始 (時間先)</Label>
                    <Input
                      id="lead"
                      type="number"
                      min={0}
                      value={form.leadTimeHours}
                      onChange={(e) => setForm({ ...form, leadTimeHours: Number(e.target.value) })}
                    />
                  </div>
                  <div {...stylex.props(styles.fieldHalf)}>
                    <Label htmlFor="range">受付期間 (日先)</Label>
                    <Input
                      id="range"
                      type="number"
                      min={1}
                      max={365}
                      value={form.rangeDays}
                      onChange={(e) => setForm({ ...form, rangeDays: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>休日除外</CardTitle>
                <CardDescription>個別に予約を受け付けない日を追加できます。</CardDescription>
              </CardHeader>
              <CardBody>
                {form.excludes.map((d, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: excludes is a list of dates that may repeat; index is needed to distinguish duplicates while editing.
                  <div key={`${d}-${i}`} {...stylex.props(styles.excludeRow)}>
                    <Input
                      type="date"
                      value={d}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          excludes: form.excludes.map((x, j) => (j === i ? e.target.value : x)),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() =>
                        setForm({ ...form, excludes: form.excludes.filter((_, j) => j !== i) })
                      }
                    >
                      削除
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    const today = new Date().toISOString().slice(0, 10);
                    setForm({ ...form, excludes: [...form.excludes, today] });
                  }}
                >
                  + 日付を追加
                </Button>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>公開設定</CardTitle>
              </CardHeader>
              <CardBody>
                <label {...stylex.props(styles.toggle)}>
                  <input
                    type="checkbox"
                    checked={form.isPublished}
                    onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
                  />
                  このリンクを公開する
                </label>
                <span {...stylex.props(styles.caption)}>
                  非公開の間、公開URLは 404 を返します。
                </span>
              </CardBody>
            </Card>
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
