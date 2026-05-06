/**
 * /invite/:token — 招待承認ページ (ISH-179, ISH-241)
 *
 * 新仕様 (ISH-176 D-7, ISH-194):
 *   GET /invitations/:token         → { workspace: { name }, email, expired }
 *   POST /invitations/:token/accept → { tenantId, role }
 *                                    401 / 404 not_found (ISH-194: email mismatch も 404 に collapse)
 *                                    409 already_accepted | user_already_in_tenant
 *                                    410 expired
 *
 * ISH-241 (O-02): Welcome 画面 (Artboard 7) に書き換え。
 *  - Slim top bar (Logo + 言語 picker mock)
 *  - 左 column: Stepper(current=0) + h1 + team card + 残り時間 + CTA
 *  - 右 column: gradient hero illustration (logo + 4 floating cards)
 *  - 既存の error state (token 不正 / 期限切れ) は維持
 */
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/logo";
import { Stepper } from "@/components/ui/stepper";
import { ApiError, api } from "@/lib/api";
import { colors, radius, shadow, space, typography } from "@/styles/tokens.stylex";

const ONBOARDING_STEPS = [
  { label: "招待を確認" },
  { label: "Googleでログイン" },
  { label: "カレンダー連携" },
  { label: "完了" },
] as const;

const styles = stylex.create({
  // ---------- shell ----------
  shell: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.bg,
    color: colors.fg,
    fontFamily: typography.fontFamilySans,
  },
  topBar: {
    height: "4rem",
    borderBottom: `1px solid ${colors.ink200}`,
    display: "flex",
    alignItems: "center",
    paddingInline: "2rem",
  },
  langPicker: {
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
    paddingBlock: "0.375rem",
    paddingInline: space.sm,
    border: `1px solid ${colors.ink200}`,
    borderRadius: radius.md,
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
    backgroundColor: "transparent",
    cursor: "default",
  },
  // ---------- 2-column body ----------
  body: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", "@media (max-width: 900px)": "1fr" },
    overflow: "hidden",
    minHeight: 0,
  },
  leftCol: {
    paddingBlock: "3.75rem",
    paddingInline: { default: "5rem", "@media (max-width: 900px)": "1.5rem" },
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  rightCol: {
    backgroundImage: `linear-gradient(160deg, ${colors.blue50} 0%, ${colors.blue100} 50%, ${colors.lilac100} 100%)`,
    position: "relative",
    display: { default: "grid", "@media (max-width: 900px)": "none" },
    placeItems: "center",
    overflow: "hidden",
  },
  stepperWrap: {
    marginBottom: "1.75rem",
  },
  h1: {
    fontSize: "2rem",
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    margin: 0,
    marginBottom: space.sm,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  lead: {
    fontSize: typography.fontSizeSm,
    color: colors.ink700,
    margin: 0,
    marginBottom: "0.25rem",
    lineHeight: 1.7,
  },
  leadStrong: {
    color: colors.blue900,
    fontWeight: typography.fontWeightBold,
  },
  leadGap: {
    marginBottom: "2rem",
  },
  // ---------- team card ----------
  teamCard: {
    display: "flex",
    alignItems: "center",
    gap: "0.875rem",
    paddingBlock: space.md,
    paddingInline: "1.25rem",
    backgroundColor: colors.blue50,
    border: `1px solid ${colors.blue150}`,
    borderRadius: radius.lg,
    marginBottom: "0.75rem",
  },
  teamAvatar: {
    width: "2.75rem",
    height: "2.75rem",
    borderRadius: radius.md,
    backgroundColor: colors.blue600,
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    fontSize: "1.125rem",
    fontWeight: typography.fontWeightBold,
    flexShrink: 0,
  },
  teamMeta: { flex: 1, minWidth: 0 },
  teamName: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  teamSub: { fontSize: typography.fontSizeXs, color: colors.ink500 },
  inviteBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    paddingBlock: "0.125rem",
    paddingInline: "0.5rem",
    backgroundColor: colors.mint100,
    color: colors.mint500,
    borderRadius: radius.full,
    fontSize: "0.6875rem",
    fontWeight: typography.fontWeightBold,
  },
  // ---------- expires line ----------
  expires: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
    marginBottom: "1.75rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
  },
  expiresStrong: {
    color: colors.ink700,
    fontWeight: typography.fontWeightBold,
    marginInline: "0.125rem",
  },
  // ---------- CTA ----------
  ctaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.sm,
    alignSelf: "flex-start",
  },
  primaryCta: {
    backgroundColor: { default: colors.blue600, ":hover": colors.blue700 },
    color: "#ffffff",
    borderColor: "transparent",
    boxShadow: shadow.blueGlow,
  },
  legal: {
    marginTop: "0.875rem",
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
  },
  legalLink: {
    color: colors.blue600,
    textDecoration: "none",
  },
  errorMsg: {
    color: colors.destructive,
    fontSize: typography.fontSizeSm,
    marginTop: space.sm,
  },
  // ---------- right hero ----------
  dotPattern: {
    position: "absolute",
    inset: 0,
    opacity: 0.25,
    backgroundImage: `radial-gradient(${colors.blue300} 1px, transparent 1px)`,
    backgroundSize: "16px 16px",
    pointerEvents: "none",
  },
  heroStage: {
    position: "relative",
    width: "27.5rem",
    height: "27.5rem",
    maxWidth: "80vw",
    maxHeight: "80vh",
  },
  bigCircle: {
    position: "absolute",
    insetBlock: "1.25rem",
    insetInline: "1.25rem",
    borderRadius: "50%",
    border: `1.5px solid ${colors.blue300}`,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dashCircle: {
    position: "absolute",
    insetBlock: "3.75rem",
    insetInline: "3.75rem",
    borderRadius: "50%",
    border: `1px dashed ${colors.blue400}`,
  },
  centerLogo: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: "10rem",
    height: "10rem",
    borderRadius: "50%",
    backgroundColor: "#ffffff",
    boxShadow: shadow.lg,
    display: "grid",
    placeItems: "center",
  },
  centerLogoInner: {
    transform: "scale(1.6)",
  },
  // ---------- floating cards (shared) ----------
  floatCard: {
    position: "absolute",
    backgroundColor: "#ffffff",
    borderRadius: radius.lg,
    paddingBlock: "0.625rem",
    paddingInline: "0.875rem",
    boxShadow: shadow.md,
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  floatTopLeft: {
    top: "1.25rem",
    left: "1.875rem",
    transform: "rotate(-6deg)",
    gap: "0.625rem",
  },
  floatTopRight: {
    top: "1.875rem",
    right: "0.625rem",
    transform: "rotate(8deg)",
  },
  floatBottomLeft: {
    bottom: "1.875rem",
    left: "0.625rem",
    transform: "rotate(-4deg)",
  },
  floatBottomRight: {
    bottom: "3.125rem",
    right: "1.875rem",
    transform: "rotate(6deg)",
  },
  miniDate: {
    width: "2.25rem",
    height: "2.5rem",
    borderRadius: "0.375rem",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    color: "#ffffff",
    fontSize: "0.5625rem",
    fontWeight: typography.fontWeightBold,
    flexShrink: 0,
  },
  miniDateMonth: {
    backgroundColor: colors.rose500,
    paddingBlock: "0.125rem",
    textAlign: "center",
  },
  miniDateDay: {
    backgroundColor: "#ffffff",
    color: colors.blue900,
    flex: 1,
    display: "grid",
    placeItems: "center",
    fontSize: "0.875rem",
  },
  cardLabel: {
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
    lineHeight: 1.2,
  },
  cardSub: {
    fontSize: "0.625rem",
    color: colors.ink500,
    marginTop: "0.125rem",
  },
});

type PreviewData = {
  workspaceName: string;
  expired: boolean;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; preview: PreviewData }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

type AcceptState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };

// --- inline icons (pre-bundled SVG, avoids extra deps) ---
function ChevronDown({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function GlobeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function ChevronRight({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function ClockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function CheckCircleIcon({ size = 11, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
function UsersIcon({ size = 20, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LinkIcon({ size = 20, color }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

// 残り時間ラベルを mock で生成 (token から expires は来ないため)。
// ISH-241: BE が expiresAt を返すまでは静的表示で OK。
function defaultExpiresLabel(): string {
  return "残り 23時間 41分";
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { isSignedIn, getToken } = auth.useAuth();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });

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
          preview: { workspaceName: data.workspace.name, expired: data.expired },
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
      await api.acceptTenantInvitation(token, getToken);
      navigate("/availability-sharings", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          navigate("/availability-sharings", { replace: true });
          return;
        }
        setAccept({ kind: "error", message: `${err.status} ${err.code}` });
        return;
      }
      setAccept({ kind: "error", message: "ワークスペース参加に失敗しました" });
    }
  }, [token, getToken, navigate]);

  if (load.kind === "loading") {
    return <ErrorShell title="招待を確認しています..." />;
  }
  if (load.kind === "not_found") {
    return (
      <ErrorShell
        title="招待が見つかりません"
        description="URL が間違っているか、既に取り消された招待の可能性があります。"
      />
    );
  }
  if (load.kind === "error") {
    return <ErrorShell title="招待を読み込めませんでした" description={load.message} />;
  }

  const { preview } = load;

  if (preview.expired) {
    return (
      <ErrorShell
        title="招待の有効期限が切れています"
        description="オーナーに、新しい招待リンクの発行を依頼してください。"
      />
    );
  }

  const teamInitial = preview.workspaceName.charAt(0).toUpperCase() || "T";
  const expiresLabel = defaultExpiresLabel();

  return (
    <div {...stylex.props(styles.shell)}>
      {/* Slim top bar */}
      <header {...stylex.props(styles.topBar)}>
        <Logo size="md" />
        {/* Lang picker is a visual mock for now (ISH-241). */}
        <span {...stylex.props(styles.langPicker)} data-testid="lang-picker">
          <GlobeIcon size={14} />
          日本語
          <ChevronDown size={12} />
        </span>
      </header>

      <div {...stylex.props(styles.body)}>
        {/* Left column */}
        <div {...stylex.props(styles.leftCol)}>
          <div {...stylex.props(styles.stepperWrap)}>
            <Stepper steps={ONBOARDING_STEPS} current={0} />
          </div>

          <h1 {...stylex.props(styles.h1)}>Ripsへようこそ</h1>
          <p {...stylex.props(styles.lead)}>
            あなたは <strong {...stylex.props(styles.leadStrong)}>{preview.workspaceName}</strong>{" "}
            のチームメンバーに招待されました。
          </p>
          <p {...stylex.props(styles.lead, styles.leadGap)}>
            セットアップを行い、Ripsの利用を開始しましょう。
          </p>

          {/* Team card */}
          <div {...stylex.props(styles.teamCard)} data-testid="team-card">
            <div {...stylex.props(styles.teamAvatar)} aria-hidden="true">
              {teamInitial}
            </div>
            <div {...stylex.props(styles.teamMeta)}>
              <div {...stylex.props(styles.teamName)}>{preview.workspaceName}</div>
              <div {...stylex.props(styles.teamSub)}>3名のメンバー · お試し期間 2026/05/25まで</div>
            </div>
            <span {...stylex.props(styles.inviteBadge)}>
              <CheckCircleIcon size={11} color="currentColor" />
              招待中
            </span>
          </div>

          <div {...stylex.props(styles.expires)} data-testid="expires-line">
            <ClockIcon size={13} />
            この招待は <strong {...stylex.props(styles.expiresStrong)}>{expiresLabel}</strong>{" "}
            有効です
          </div>

          {accept.kind === "error" && (
            <p role="alert" {...stylex.props(styles.errorMsg)}>
              {accept.message}
            </p>
          )}

          <div {...stylex.props(styles.ctaRow)}>
            {isSignedIn ? (
              <Button
                type="button"
                size="lg"
                onClick={onAccept}
                loading={accept.kind === "submitting"}
                rightIcon={<ChevronRight size={16} />}
                style={stylex.props(styles.primaryCta).style}
                className={stylex.props(styles.primaryCta).className}
              >
                テナントに参加
              </Button>
            ) : (
              <>
                <auth.SignInButton
                  mode="modal"
                  forceRedirectUrl={returnUrl}
                  signUpForceRedirectUrl={returnUrl}
                >
                  <Button
                    size="lg"
                    rightIcon={<ChevronRight size={16} />}
                    style={stylex.props(styles.primaryCta).style}
                    className={stylex.props(styles.primaryCta).className}
                  >
                    サインインして承認
                  </Button>
                </auth.SignInButton>
                <auth.SignUpButton
                  mode="modal"
                  forceRedirectUrl={returnUrl}
                  signInForceRedirectUrl={returnUrl}
                >
                  <Button variant="outline" size="lg">
                    アカウントを作成
                  </Button>
                </auth.SignUpButton>
              </>
            )}
          </div>

          <div {...stylex.props(styles.legal)}>
            続行することで、Ripsの
            <a href="#terms" {...stylex.props(styles.legalLink)}>
              利用規約
            </a>
            と
            <a href="#privacy" {...stylex.props(styles.legalLink)}>
              プライバシーポリシー
            </a>
            に同意したものとみなされます。
          </div>
        </div>

        {/* Right hero illustration */}
        <div {...stylex.props(styles.rightCol)} aria-hidden="true">
          <div {...stylex.props(styles.dotPattern)} />
          <div {...stylex.props(styles.heroStage)}>
            <div {...stylex.props(styles.bigCircle)} />
            <div {...stylex.props(styles.dashCircle)} />
            <div {...stylex.props(styles.centerLogo)}>
              <div {...stylex.props(styles.centerLogoInner)}>
                <Logo size="md" />
              </div>
            </div>

            {/* Calendar */}
            <div {...stylex.props(styles.floatCard, styles.floatTopLeft)}>
              <div {...stylex.props(styles.miniDate)}>
                <div {...stylex.props(styles.miniDateMonth)}>MAY</div>
                <div {...stylex.props(styles.miniDateDay)}>17</div>
              </div>
              <div>
                <div {...stylex.props(styles.cardLabel)}>カレンダー</div>
                <div {...stylex.props(styles.cardSub)}>予定を一括管理</div>
              </div>
            </div>

            {/* Team */}
            <div {...stylex.props(styles.floatCard, styles.floatTopRight)}>
              <UsersIcon size={20} color={colors.blue600} />
              <div>
                <div {...stylex.props(styles.cardLabel)}>チーム</div>
                <div {...stylex.props(styles.cardSub)}>共催で予定調整</div>
              </div>
            </div>

            {/* Availability link */}
            <div {...stylex.props(styles.floatCard, styles.floatBottomLeft)}>
              <LinkIcon size={20} color={colors.mint500} />
              <div>
                <div {...stylex.props(styles.cardLabel)}>空き時間リンク</div>
                <div {...stylex.props(styles.cardSub)}>ワンクリック共有</div>
              </div>
            </div>

            {/* Auto conflict avoidance */}
            <div {...stylex.props(styles.floatCard, styles.floatBottomRight)}>
              <CheckCircleIcon size={20} color={colors.blue500} />
              <div>
                <div {...stylex.props(styles.cardLabel)}>自動衝突回避</div>
                <div {...stylex.props(styles.cardSub)}>予定のダブり防止</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 招待が解決できない / 期限切れ等の error state は元の Card 構造を維持して
 * シンプルに表示する (タイトルと説明文)。
 */
function ErrorShell({ title, description }: { title: string; description?: string }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "32rem" }}>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
