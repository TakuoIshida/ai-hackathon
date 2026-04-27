import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { httpFetch } from "@/lib/http";
import { PublicApiError } from "@/lib/public-api";
import { colors, space } from "@/styles/tokens.stylex";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok"; alreadyCanceled: boolean }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export default function CancelBooking() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "idle" });

  const onConfirm = async () => {
    if (!token) return;
    setState({ kind: "submitting" });
    try {
      const res = await httpFetch(`${API_URL}/public/cancel/${encodeURIComponent(token)}`, {
        method: "POST",
      });
      if (res.status === 404) {
        setState({ kind: "not_found" });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new PublicApiError(res.status, body.error ?? "request_failed");
      }
      const data = (await res.json()) as { ok: boolean; alreadyCanceled?: boolean };
      setState({ kind: "ok", alreadyCanceled: Boolean(data.alreadyCanceled) });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "送信に失敗しました",
      });
    }
  };

  if (state.kind === "ok") {
    return (
      <div {...stylex.props(styles.page)}>
        <Card>
          <CardHeader>
            <CardTitle>
              {state.alreadyCanceled ? "既にキャンセル済みです" : "予約をキャンセルしました"}
            </CardTitle>
            <CardDescription>ご利用ありがとうございました。タブを閉じてください。</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (state.kind === "not_found") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>キャンセルリンクが見つかりません</CardTitle>
          <CardDescription>
            URL が間違っているか、既に削除された予約の可能性があります。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div {...stylex.props(styles.page)}>
      <Card>
        <CardHeader>
          <CardTitle>予約をキャンセルしますか？</CardTitle>
          <CardDescription>
            この操作は取り消せません。確定すると主催者にも通知が届きます。
          </CardDescription>
        </CardHeader>
        <CardBody>
          <p>
            キャンセルトークン: <code>{token}</code>
          </p>
          {state.kind === "error" && <p {...stylex.props(styles.error)}>{state.message}</p>}
        </CardBody>
        <CardFooter>
          <Button
            variant="destructive"
            type="button"
            onClick={onConfirm}
            disabled={state.kind === "submitting"}
          >
            {state.kind === "submitting" ? "送信中..." : "キャンセル確定"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
