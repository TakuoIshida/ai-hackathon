/**
 * /onboarding route — tenant 作成フロー (ISH-179)
 *
 * - サインイン済みユーザーのみアクセス可。未サインインは /sign-in へリダイレクト。
 * - フォームで tenant 名を入力 → POST /onboarding/tenant
 * - 201 成功 or 409 already_member → /dashboard へ遷移
 * - 400 → フォーム内エラー表示
 *
 * 新規ユーザーは Sign-in/Sign-up 後ここに遷移し、tenant を作成してから
 * /dashboard へ進む。既存 tenant 所属ユーザーは 409 already_member で
 * 自動的に /dashboard へリダイレクトされる。
 */
import * as stylex from "@stylexjs/stylex";
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { colors, radius, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    backgroundColor: colors.bg,
    color: colors.fg,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingBlock: space.xl,
    paddingInline: space.md,
    gap: space.lg,
  },
  card: {
    width: "100%",
    maxWidth: "28rem",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.lg,
    padding: space.xl,
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  heading: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 600,
  },
  subhead: {
    margin: 0,
    color: colors.muted,
    fontSize: "0.95rem",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: space.md,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  label: {
    fontSize: "0.875rem",
    fontWeight: 500,
  },
  hint: {
    fontSize: "0.8125rem",
    color: colors.muted,
  },
  errorText: {
    fontSize: "0.875rem",
    color: colors.destructive,
  },
});

type SubmitState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

function validateTenantName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "テナント名を入力してください";
  if (trimmed.length > 120) return "テナント名は120文字以内で入力してください";
  return null;
}

function OnboardingForm() {
  const { isLoaded, isSignedIn, getToken } = auth.useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // Wait for the auth adapter to finish loading before deciding to redirect —
  // otherwise we flash signed-in users to /sign-in during the initial mount.
  if (!isLoaded) return null;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validationError = validateTenantName(name);
    if (validationError) {
      setSubmitState({ kind: "error", message: validationError });
      return;
    }
    setSubmitState({ kind: "submitting" });
    try {
      await api.createTenant(name.trim(), getToken);
      // 201 → tenant created successfully → go to dashboard
      navigate("/availability-sharings", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          // already_member → user already belongs to a tenant → go to dashboard
          navigate("/availability-sharings", { replace: true });
          return;
        }
        if (err.status === 400) {
          setSubmitState({ kind: "error", message: "入力内容を確認してください (400)" });
          return;
        }
        if (err.status === 401) {
          navigate("/sign-in", { replace: true });
          return;
        }
        setSubmitState({ kind: "error", message: `エラーが発生しました (${err.status})` });
        return;
      }
      setSubmitState({ kind: "error", message: "予期しないエラーが発生しました" });
    }
  }

  const isSubmitting = submitState.kind === "submitting";

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.header)}>
          <h1 {...stylex.props(styles.heading)}>テナントを作成</h1>
          <p {...stylex.props(styles.subhead)}>
            チームやプロジェクトの名前を入力して、スペースを作成してください。
          </p>
        </div>
        <form {...stylex.props(styles.form)} onSubmit={onSubmit} noValidate>
          <div {...stylex.props(styles.field)}>
            <label htmlFor="tenant-name" {...stylex.props(styles.label)}>
              テナント名
            </label>
            <Input
              id="tenant-name"
              type="text"
              placeholder="例: Acme Inc."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (submitState.kind === "error") setSubmitState({ kind: "idle" });
              }}
              disabled={isSubmitting}
              autoFocus
              maxLength={120}
            />
            <span {...stylex.props(styles.hint)}>1〜120文字で入力してください</span>
            {submitState.kind === "error" && (
              <span role="alert" {...stylex.props(styles.errorText)}>
                {submitState.message}
              </span>
            )}
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "作成中..." : "テナントを作成"}
          </Button>
        </form>
      </div>
    </main>
  );
}

export default function Onboarding() {
  return <OnboardingForm />;
}
