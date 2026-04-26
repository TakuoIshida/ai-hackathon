import { useAuth } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import type { WorkspaceDetail } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "40rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  meta: { display: "flex", flexDirection: "column", gap: space.xs },
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: "0.8125rem", color: colors.muted },
  value: { fontSize: "0.9375rem", fontWeight: 500 },
  badge: {
    display: "inline-block",
    fontSize: "0.7rem",
    padding: "0.125rem 0.4rem",
    borderRadius: "999px",
    backgroundColor: colors.accent,
    color: colors.accentFg,
  },
  empty: { fontSize: "0.875rem", color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

export default function WorkspaceDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getWorkspace(id, () => getToken());
      setWorkspace(data.workspace);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError("ワークスペースが見つかりません");
      } else {
        setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, [id, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>ワークスペース詳細</h1>

      {loading && <p {...stylex.props(styles.empty)}>読み込み中...</p>}
      {error && (
        <Card>
          <CardHeader>
            <CardTitle>エラー</CardTitle>
          </CardHeader>
          <CardBody>
            <p {...stylex.props(styles.error)}>{error}</p>
            <Button asChild variant="outline">
              <Link to="/dashboard/workspaces">一覧へ戻る</Link>
            </Button>
          </CardBody>
        </Card>
      )}

      {!loading && !error && workspace && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{workspace.name}</CardTitle>
              <CardDescription>/{workspace.slug}</CardDescription>
            </CardHeader>
            <CardBody>
              <div {...stylex.props(styles.meta)}>
                <div {...stylex.props(styles.metaRow)}>
                  <span {...stylex.props(styles.label)}>あなたのロール</span>
                  <span {...stylex.props(styles.badge)}>{workspace.role}</span>
                </div>
                <div {...stylex.props(styles.metaRow)}>
                  <span {...stylex.props(styles.label)}>作成日時</span>
                  <span {...stylex.props(styles.value)}>
                    {new Date(workspace.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>メンバー</CardTitle>
              <CardDescription>メンバー管理は今後のアップデートで対応します。</CardDescription>
            </CardHeader>
            <CardBody>
              <p {...stylex.props(styles.empty)}>メンバー一覧 UI は ISH-110 で対応予定。</p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
