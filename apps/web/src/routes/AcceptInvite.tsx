/**
 * /invite/:token — 招待承認ページ (ISH-179)
 *
 * 新仕様 (ISH-176 D-7, ISH-194):
 *   GET /invitations/:token         → { workspace: { name }, email, expired }
 *   POST /invitations/:token/accept → { tenantId, role }
 *                                    401 / 404 not_found (ISH-194: email mismatch も 404 に collapse)
 *                                    409 already_accepted | user_already_in_tenant
 *                                    410 expired
 *
 * - 未サインインユーザーへはモーダルでサインイン/サインアップを促す。
 * - サインイン済みユーザーが承認ボタンを押すと POST を呼び、成功時に /dashboard へ遷移。
 */
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { ApiError, api } from "@/lib/api";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  row: { display: "flex", gap: space.sm, flexWrap: "wrap" },
  meta: { color: colors.muted, fontSize: "0.875rem" },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

type PreviewData = {
  workspaceName: string;
  email: string;
  expired: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; preview: PreviewData }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

type AcceptState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  // We branch on `isSignedIn` rather than wrapping with <SignedIn>/<SignedOut>
  // so the component is straightforward to test with a single mock of
  // `useAuth` (see Settings.test.tsx for the stable-getToken pattern).
  const { isSignedIn, getToken } = auth.useAuth();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });

  // After Clerk's sign-in / sign-up modal completes, we want the user
  // returned right back to /invite/:token so the auth branch of this
  // page renders and they can press the accept button. Use an absolute
  // URL — Clerk's modal expects fully qualified return URLs.
  const returnUrl =
    typeof window !== "undefined" && token ? `${window.location.origin}/invite/${token}` : "/";

  useEffect(() => {
    if (!token) {
      setLoad({ kind: "not_found" });
      return;
    }
    let alive = true;
    (async () => {
      try {
        // GET /invitations/:token (public preview — no auth required)
        const data = await api.getInvitation(token);
        if (!alive) return;
        setLoad({
          kind: "loaded",
          preview: {
            workspaceName: data.workspace.name,
            email: data.email,
            expired: data.expired,
          },
        });
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoad({ kind: "not_found" });
          return;
        }
        setLoad({
          kind: "error",
          message:
            err instanceof ApiError ? `${err.status} ${err.code}` : "招待の読み込みに失敗しました",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const onAccept = useCallback(async () => {
    if (!token) return;
    setAccept({ kind: "submitting" });
    try {
      // POST /invitations/:token/accept → { tenantId, role }
      await api.acceptTenantInvitation(token, getToken);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          // already_accepted or user_already_in_tenant → already belongs to tenant
          navigate("/dashboard", { replace: true });
          return;
        }
        setAccept({
          kind: "error",
          message: `${err.status} ${err.code}`,
        });
        return;
      }
      setAccept({
        kind: "error",
        message: "ワークスペース参加に失敗しました",
      });
    }
  }, [token, getToken, navigate]);

  if (load.kind === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>招待を確認しています...</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (load.kind === "not_found") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>招待が見つかりません</CardTitle>
          <CardDescription>
            URL が間違っているか、既に取り消された招待の可能性があります。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (load.kind === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>招待を読み込めませんでした</CardTitle>
          <CardDescription>{load.message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { preview } = load;

  if (preview.expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>招待の有効期限が切れています</CardTitle>
          <CardDescription>管理者に、新しい招待リンクの発行を依頼してください。</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div {...stylex.props(styles.page)}>
      <Card>
        <CardHeader>
          <CardTitle>{preview.workspaceName} に招待されています</CardTitle>
          <CardDescription>
            <span {...stylex.props(styles.meta)}>{preview.email}</span> 宛の招待です。
          </CardDescription>
        </CardHeader>
        <CardBody>
          {accept.kind === "error" && (
            <p role="alert" {...stylex.props(styles.error)}>
              {accept.message}
            </p>
          )}
        </CardBody>
        <CardFooter>
          {isSignedIn ? (
            <Button type="button" onClick={onAccept} disabled={accept.kind === "submitting"}>
              {accept.kind === "submitting" ? "参加中..." : "テナントに参加"}
            </Button>
          ) : (
            <div {...stylex.props(styles.row)}>
              <auth.SignInButton
                mode="modal"
                forceRedirectUrl={returnUrl}
                signUpForceRedirectUrl={returnUrl}
              >
                <Button>サインインして承認</Button>
              </auth.SignInButton>
              <auth.SignUpButton
                mode="modal"
                forceRedirectUrl={returnUrl}
                signInForceRedirectUrl={returnUrl}
              >
                <Button variant="outline">アカウントを作成</Button>
              </auth.SignUpButton>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
