import { useAuth } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import type { LinkSummary } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  list: { display: "flex", flexDirection: "column", gap: space.md },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: space.md,
    border: `1px solid ${colors.border}`,
    borderRadius: "0.5rem",
  },
  meta: { display: "flex", flexDirection: "column", gap: space.xs },
  title: { fontWeight: 600 },
  caption: { fontSize: "0.875rem", color: colors.muted },
  badge: {
    fontSize: "0.75rem",
    padding: "0.125rem 0.5rem",
    borderRadius: "999px",
    backgroundColor: colors.accent,
    color: colors.accentFg,
  },
  badgePublished: {
    backgroundColor: colors.primary,
    color: colors.primaryFg,
  },
  empty: { textAlign: "center", padding: space.xl, color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

type LoadState =
  | { status: "loading" }
  | { status: "ok"; links: LinkSummary[] }
  | { status: "error"; message: string };

export default function Links() {
  const { getToken } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const reload = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { links } = await api.listLinks(() => getToken());
      setState({ status: "ok", links });
    } catch (err) {
      const message = err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load";
      setState({ status: "error", message });
    }
  }, [getToken]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.toolbar)}>
        <h1 {...stylex.props(styles.heading)}>リンク</h1>
        <Button asChild>
          <Link to="/dashboard/links/new">+ 新規リンク</Link>
        </Button>
      </div>

      {state.status === "loading" && <div {...stylex.props(styles.empty)}>読み込み中...</div>}

      {state.status === "error" && (
        <Card>
          <CardHeader>
            <CardTitle>読み込みに失敗しました</CardTitle>
            <CardDescription>API への接続を確認してください。</CardDescription>
          </CardHeader>
          <CardBody>
            <p {...stylex.props(styles.error)}>{state.message}</p>
            <Button variant="outline" onClick={reload}>
              再試行
            </Button>
          </CardBody>
        </Card>
      )}

      {state.status === "ok" && state.links.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>まだリンクがありません</CardTitle>
            <CardDescription>新規リンクを作って公開URLを発行できます。</CardDescription>
          </CardHeader>
          <CardBody>
            <div {...stylex.props(styles.empty)}>—</div>
          </CardBody>
        </Card>
      )}

      {state.status === "ok" && state.links.length > 0 && (
        <div {...stylex.props(styles.list)}>
          {state.links.map((link) => (
            <LinkRow key={link.id} link={link} />
          ))}
        </div>
      )}
    </div>
  );
}

function LinkRow({ link }: { link: LinkSummary }) {
  const onCopy = () => {
    const publicUrl = `${window.location.origin}/${link.slug}`;
    void navigator.clipboard?.writeText(publicUrl);
  };
  return (
    <div {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.meta)}>
        <span {...stylex.props(styles.title)}>{link.title}</span>
        <span {...stylex.props(styles.caption)}>
          /{link.slug} · {link.durationMinutes}分 ·{" "}
          <span
            {...stylex.props(styles.badge, link.isPublished ? styles.badgePublished : undefined)}
          >
            {link.isPublished ? "公開中" : "下書き"}
          </span>
        </span>
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button variant="outline" size="sm" onClick={onCopy}>
          URLコピー
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={`/dashboard/links/${link.id}/edit`}>編集</Link>
        </Button>
      </div>
    </div>
  );
}
