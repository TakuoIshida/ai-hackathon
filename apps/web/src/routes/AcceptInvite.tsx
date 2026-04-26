import { SignInButton, SignUpButton, useAuth } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import type { InvitationSummary } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  row: { display: "flex", gap: space.sm, flexWrap: "wrap" },
  meta: { color: colors.muted, fontSize: "0.875rem" },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; invitation: InvitationSummary }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

type AcceptState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  // We branch on `isSignedIn` rather than wrapping with <SignedIn>/<SignedOut>
  // so the component is straightforward to test with a single mock of
  // `useAuth` (see Settings.test.tsx for the stable-getToken pattern).
  const { isSignedIn, getToken } = useAuth();
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
        const data = await api.getInvitation(token);
        if (!alive) return;
        setLoad({
          kind: "loaded",
          invitation: {
            workspaceName: data.workspace.name,
            workspaceSlug: data.workspace.slug,
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
      const res = await api.acceptInvitation(token, () => getToken());
      navigate(res.workspace.id ? `/dashboard/workspaces/${res.workspace.id}` : "/dashboard");
    } catch (err) {
      setAccept({
        kind: "error",
        message:
          err instanceof ApiError
            ? `${err.status} ${err.code}`
            : "ワークスペース参加に失敗しました",
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

  const { invitation } = load;

  if (invitation.expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>招待の有効期限が切れています</CardTitle>
          <CardDescription>
            ワークスペースのオーナーに、新しい招待リンクの発行を依頼してください。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div {...stylex.props(styles.page)}>
      <Card>
        <CardHeader>
          <CardTitle>{invitation.workspaceName} に招待されています</CardTitle>
          <CardDescription>
            <span {...stylex.props(styles.meta)}>{invitation.email}</span> 宛の招待です。
          </CardDescription>
        </CardHeader>
        <CardBody>
          {accept.kind === "error" && <p {...stylex.props(styles.error)}>{accept.message}</p>}
        </CardBody>
        <CardFooter>
          {isSignedIn ? (
            <Button type="button" onClick={onAccept} disabled={accept.kind === "submitting"}>
              {accept.kind === "submitting" ? "参加中..." : "ワークスペースに参加"}
            </Button>
          ) : (
            <div {...stylex.props(styles.row)}>
              <SignInButton
                mode="modal"
                forceRedirectUrl={returnUrl}
                signUpForceRedirectUrl={returnUrl}
              >
                <Button>サインインして承認</Button>
              </SignInButton>
              <SignUpButton
                mode="modal"
                forceRedirectUrl={returnUrl}
                signInForceRedirectUrl={returnUrl}
              >
                <Button variant="outline">アカウントを作成</Button>
              </SignUpButton>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
