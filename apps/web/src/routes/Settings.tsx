import { useAuth } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
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
import { ApiError, api, googleConnectUrl } from "@/lib/api";
import type { GoogleConnection } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "40rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
  account: { fontSize: "0.875rem", color: colors.muted },
  list: { display: "flex", flexDirection: "column", gap: space.sm },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: space.md,
    alignItems: "center",
    padding: space.sm,
    border: `1px solid ${colors.border}`,
    borderRadius: "0.375rem",
  },
  rowMeta: { display: "flex", flexDirection: "column", gap: "0.125rem" },
  rowTitle: { fontSize: "0.875rem", fontWeight: 500 },
  rowSub: { fontSize: "0.75rem", color: colors.muted },
  toggle: { display: "flex", alignItems: "center", gap: space.xs, fontSize: "0.75rem" },
  badge: {
    display: "inline-block",
    fontSize: "0.7rem",
    padding: "0.125rem 0.4rem",
    borderRadius: "999px",
    backgroundColor: colors.accent,
    color: colors.accentFg,
    marginLeft: space.xs,
  },
  empty: { fontSize: "0.875rem", color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

export default function Settings() {
  const { getToken } = useAuth();
  const [conn, setConn] = useState<GoogleConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGoogleConnection(() => getToken());
      setConn(data);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
    // Re-fetch on returning from /google/connect with the success query param.
    if (new URLSearchParams(window.location.search).get("google_connected") === "1") {
      // Strip the query param so a refresh won't re-trigger.
      const url = new URL(window.location.href);
      url.searchParams.delete("google_connected");
      window.history.replaceState({}, "", url.toString());
    }
  }, [load]);

  const onDisconnect = async () => {
    if (!confirm("Google アカウントとの連携を解除します。よろしいですか？")) return;
    setDisconnecting(true);
    setError(null);
    try {
      await api.disconnectGoogle(() => getToken());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>設定</h1>

      <Card>
        <CardHeader>
          <CardTitle>Google Workspace 連携</CardTitle>
          <CardDescription>
            空き時間計算と Meet URL 自動発行に使う Google アカウントを連携します。
          </CardDescription>
        </CardHeader>
        <CardBody>
          {loading && <p {...stylex.props(styles.empty)}>読み込み中...</p>}
          {error && <p {...stylex.props(styles.error)}>{error}</p>}

          {!loading && !error && conn && !conn.connected && (
            <Button asChild variant="outline">
              <a href={googleConnectUrl}>Google アカウントを連携</a>
            </Button>
          )}

          {!loading && !error && conn?.connected && (
            <>
              <p {...stylex.props(styles.account)}>
                連携中: <strong>{conn.accountEmail}</strong>
              </p>
              <CardSection title="同期されたカレンダー">
                {conn.calendars.length === 0 ? (
                  <p {...stylex.props(styles.empty)}>カレンダーが見つかりません。</p>
                ) : (
                  <div {...stylex.props(styles.list)}>
                    {conn.calendars.map((cal) => (
                      <div key={cal.id} {...stylex.props(styles.row)}>
                        <div {...stylex.props(styles.rowMeta)}>
                          <span {...stylex.props(styles.rowTitle)}>
                            {cal.summary ?? cal.id}
                            {cal.isPrimary && <span {...stylex.props(styles.badge)}>primary</span>}
                          </span>
                          <span {...stylex.props(styles.rowSub)}>{cal.id}</span>
                        </div>
                        <span {...stylex.props(styles.toggle)}>
                          {cal.usedForBusy ? "✓ 空き判定" : "—"}
                        </span>
                        <span {...stylex.props(styles.toggle)}>
                          {cal.usedForWrites ? "✓ 書込先" : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p {...stylex.props(styles.empty)}>
                  カレンダーごとの設定変更は v1.5 で対応予定。今は primary が書込先・全部 busy
                  判定対象です。
                </p>
              </CardSection>
            </>
          )}
        </CardBody>
        {conn?.connected && (
          <CardFooter>
            <Button variant="destructive" onClick={onDisconnect} disabled={disconnecting}>
              {disconnecting ? "解除中..." : "連携を解除"}
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="tz">タイムゾーン</Label>
            <Input id="tz" defaultValue="Asia/Tokyo" />
          </div>
          <p {...stylex.props(styles.empty)}>※ 現在は表示のみ。保存は v1.5 で対応予定 (ISH-57)。</p>
        </CardBody>
      </Card>
    </div>
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div {...stylex.props(styles.field)}>
      <span style={{ fontWeight: 600, marginTop: "0.5rem" }}>{title}</span>
      {children}
    </div>
  );
}
