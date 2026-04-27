import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import type { WorkspaceSummary } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "40rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  list: { display: "flex", flexDirection: "column", gap: space.sm },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: space.md,
    alignItems: "center",
    padding: space.md,
    border: `1px solid ${colors.border}`,
    borderRadius: "0.5rem",
    textDecoration: "none",
    color: colors.fg,
    backgroundColor: { default: "transparent", ":hover": colors.accent },
  },
  rowMeta: { display: "flex", flexDirection: "column", gap: "0.125rem" },
  rowTitle: { fontSize: "0.875rem", fontWeight: 600 },
  rowSub: { fontSize: "0.75rem", color: colors.muted },
  badge: {
    display: "inline-block",
    fontSize: "0.7rem",
    padding: "0.125rem 0.4rem",
    borderRadius: "999px",
    backgroundColor: colors.accent,
    color: colors.accentFg,
  },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  caption: { fontSize: "0.8125rem", color: colors.muted },
  empty: { fontSize: "0.875rem", color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

export default function Workspaces() {
  const { getToken } = auth.useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<WorkspaceSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.listWorkspaces(() => getToken());
      setList(data.workspaces);
    } catch (err) {
      setLoadError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { workspace } = await api.createWorkspace({ name, slug }, () => getToken());
      navigate(`/dashboard/workspaces/${workspace.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSubmitError("このスラッグは使用済みです");
      } else if (err instanceof ApiError) {
        setSubmitError(`${err.status}: ${err.code}`);
      } else {
        setSubmitError("作成に失敗しました");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const slugIsValid = /^[a-z0-9-]+$/.test(slug) && slug.length > 0;
  const canSubmit = !submitting && name.length > 0 && slugIsValid;

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>ワークスペース</h1>

      <Card>
        <CardHeader>
          <CardTitle>新規ワークスペース</CardTitle>
          <CardDescription>
            作成すると自動で owner ロールが付与され、詳細画面へ遷移します。
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardBody>
            <div {...stylex.props(styles.field)}>
              <Label htmlFor="ws-name">名前</Label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
                maxLength={200}
                required
              />
            </div>
            <div {...stylex.props(styles.field)}>
              <Label htmlFor="ws-slug">スラッグ</Label>
              <Input
                id="ws-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme"
                maxLength={64}
                required
              />
              <span {...stylex.props(styles.caption)}>
                小文字英数字とハイフンのみ。後から変更できません。
              </span>
            </div>
            {submitError && <p {...stylex.props(styles.error)}>{submitError}</p>}
          </CardBody>
          <CardFooter>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? "作成中..." : "作成"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>参加中のワークスペース</CardTitle>
        </CardHeader>
        <CardBody>
          {loading && <p {...stylex.props(styles.empty)}>読み込み中...</p>}
          {loadError && <p {...stylex.props(styles.error)}>{loadError}</p>}
          {!loading && !loadError && list !== null && list.length === 0 && (
            <p {...stylex.props(styles.empty)}>まだワークスペースがありません。</p>
          )}
          {!loading && !loadError && list !== null && list.length > 0 && (
            <div {...stylex.props(styles.list)}>
              {list.map((w) => (
                <Link key={w.id} to={`/dashboard/workspaces/${w.id}`} {...stylex.props(styles.row)}>
                  <div {...stylex.props(styles.rowMeta)}>
                    <span {...stylex.props(styles.rowTitle)}>{w.name}</span>
                    <span {...stylex.props(styles.rowSub)}>/{w.slug}</span>
                  </div>
                  <span {...stylex.props(styles.badge)}>{w.role}</span>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
