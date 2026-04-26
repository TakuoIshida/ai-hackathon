import { useAuth } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import {
  BUFFER_CHOICES,
  DEFAULT_RANGE_DAYS,
  DURATION_CHOICES,
  type LinkInput,
  SLOT_INTERVAL_CHOICES,
  WEEKDAY_LABELS,
  type Weekday,
} from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const browserTimeZone =
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Asia/Tokyo";

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
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "48rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
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
  actions: { display: "flex", gap: space.sm, justifyContent: "flex-end" },
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
  const { getToken } = useAuth();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [form, setForm] = useState<LinkInput>(emptyInput);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isEdit && id) {
        await api.updateLink(id, form, () => getToken());
      } else {
        await api.createLink(form, () => getToken());
      }
      navigate("/dashboard/links");
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

  if (loading) return <p>読み込み中...</p>;

  return (
    <form {...stylex.props(styles.page)} onSubmit={onSubmit}>
      <h1 {...stylex.props(styles.heading)}>{isEdit ? "リンクを編集" : "新規リンク"}</h1>

      <Card>
        <CardHeader>
          <CardTitle>基本情報</CardTitle>
          <CardDescription>公開URL、タイトル、会議時間を設定します。</CardDescription>
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
            <Label htmlFor="title">タイトル</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
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
            <Label htmlFor="duration">会議時間</Label>
            <select
              id="duration"
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
            >
              {DURATION_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {d} 分
                </option>
              ))}
            </select>
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
                onChange={(e) => setForm({ ...form, bufferBeforeMinutes: Number(e.target.value) })}
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
                onChange={(e) => setForm({ ...form, bufferAfterMinutes: Number(e.target.value) })}
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
                    slotIntervalMinutes: e.target.value === "" ? null : Number(e.target.value),
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
          <span {...stylex.props(styles.caption)}>非公開の間、公開URLは 404 を返します。</span>
        </CardBody>
      </Card>

      {error && <p {...stylex.props(styles.error)}>{error}</p>}

      <div {...stylex.props(styles.actions)}>
        <Button variant="outline" type="button" onClick={() => navigate("/dashboard/links")}>
          キャンセル
        </Button>
        <Button type="submit" disabled={submitting || slugStatus === "taken"}>
          {submitting ? "送信中..." : isEdit ? "更新" : "作成"}
        </Button>
      </div>
    </form>
  );
}
