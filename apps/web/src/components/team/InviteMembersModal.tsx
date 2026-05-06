import * as stylex from "@stylexjs/stylex";
import { Clock, Send, Shield, UserPlus } from "lucide-react";
import * as React from "react";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailChipsInput, isValidEmail } from "@/components/ui/email-chips-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError, api } from "@/lib/api";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

/**
 * InviteMembersModal (ISH-239 / M-02).
 *
 * メンバー招待モーダル。EmailChipsInput (M-01) で複数 email を chip 化し、
 * 権限 (メンバー / オーナー = API role member / owner) を select で選び、
 * `/tenant/invitations` に email ごとに POST する。
 *
 * The API accepts one email per request, so we fan out with `Promise.all`
 * and aggregate per-email failures into the toast — this avoids gating the
 * whole batch on the first 409 (already_invited / already_member) and matches
 * the design intent that the user can re-submit only the addresses that
 * failed.
 */

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInlineEnd: "2.25rem", // leave room for the built-in close (X) button
  },
  headerIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: colors.blue600,
  },
  intro: {
    margin: 0,
    fontSize: typography.fontSizeSm,
    color: colors.ink700,
    lineHeight: typography.lineHeightNormal,
  },
  introStrong: {
    color: colors.blue900,
    fontWeight: typography.fontWeightBold,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  fieldLabel: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightMedium,
    color: colors.ink700,
  },
  callout: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.sm,
    paddingInline: space.md,
    paddingBlock: space.sm,
    backgroundColor: colors.blue50,
    border: `1px solid ${colors.blue150}`,
    borderRadius: radius.md,
  },
  calloutIcon: {
    color: colors.blue600,
    flexShrink: 0,
    marginBlockStart: "0.125rem",
  },
  calloutBody: {
    fontSize: typography.fontSizeXs,
    color: colors.blue900,
    lineHeight: typography.lineHeightNormal,
  },
  calloutBodySoft: {
    color: colors.ink700,
  },
  expiryNote: {
    display: "flex",
    alignItems: "center",
    gap: space.xs,
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
  },
  expiryStrong: {
    color: colors.ink700,
    fontWeight: typography.fontWeightMedium,
  },
});

type InviteRole = "member" | "owner";

export type InviteMembersModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
};

export function InviteMembersModal({ open, onOpenChange, teamName }: InviteMembersModalProps) {
  const [emails, setEmails] = React.useState<string[]>([]);
  const [role, setRole] = React.useState<InviteRole>("member");
  const [submitting, setSubmitting] = React.useState(false);
  const { getToken } = auth.useAuth();
  const { toast } = useToast();

  // Reset form whenever the modal closes so a re-open starts blank.
  React.useEffect(() => {
    if (!open) {
      setEmails([]);
      setRole("member");
      setSubmitting(false);
    }
  }, [open]);

  const validEmails = React.useMemo(() => emails.filter(isValidEmail), [emails]);
  const hasInvalid = emails.length > 0 && validEmails.length !== emails.length;
  const submitDisabled = emails.length === 0 || hasInvalid || submitting;

  const handleSubmit = async () => {
    if (submitDisabled) return;
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(
        validEmails.map((email) => api.createTenantInvitation({ email, role }, () => getToken())),
      );
      const failures: { email: string; reason: string }[] = [];
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          const reason = r.reason instanceof ApiError ? r.reason.code : "request_failed";
          failures.push({ email: validEmails[i] ?? "", reason });
        }
      });
      const successCount = results.length - failures.length;
      if (failures.length === 0) {
        toast({
          title: "招待メールを送信しました",
          description: `${successCount}名に招待メールを送信しました。`,
          variant: "success",
        });
        onOpenChange(false);
      } else if (successCount === 0) {
        toast({
          title: "招待の送信に失敗しました",
          description: failures.map((f) => `${f.email}: ${f.reason}`).join(", "),
          variant: "destructive",
        });
      } else {
        toast({
          title: "一部の招待を送信できませんでした",
          description: `${successCount}件成功 / ${failures.length}件失敗 (${failures
            .map((f) => f.email)
            .join(", ")})`,
          variant: "destructive",
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel =
    emails.length > 0 ? `招待メールを送信 (${emails.length}名)` : "招待メールを送信";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        data-testid="invite-members-modal"
        style={{ maxWidth: "36rem" }}
      >
        <div {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.headerIcon)} aria-hidden="true">
            <UserPlus size={22} />
          </span>
          <DialogTitle>メンバーを招待</DialogTitle>
        </div>

        <p {...stylex.props(styles.intro)}>
          チーム <strong {...stylex.props(styles.introStrong)}>{teamName}</strong>{" "}
          にメンバーを招待します。 招待メールには{" "}
          <strong {...stylex.props(styles.introStrong)}>24時間有効</strong>のリンクが含まれます。
        </p>

        <div {...stylex.props(styles.field)}>
          <label {...stylex.props(styles.fieldLabel)} htmlFor="invite-emails">
            招待するメールアドレス
          </label>
          <EmailChipsInput
            id="invite-emails"
            aria-label="招待するメールアドレス"
            value={emails}
            onChange={setEmails}
            disabled={submitting}
          />
        </div>

        <div {...stylex.props(styles.field)}>
          <label {...stylex.props(styles.fieldLabel)} htmlFor="invite-role">
            権限
          </label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as InviteRole)}
            disabled={submitting}
          >
            <SelectTrigger id="invite-role" data-testid="invite-role-trigger">
              <SelectValue placeholder="メンバー" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member">メンバー</SelectItem>
              <SelectItem value="owner">オーナー</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div {...stylex.props(styles.callout)}>
          <span {...stylex.props(styles.calloutIcon)} aria-hidden="true">
            <Shield size={18} />
          </span>
          <div {...stylex.props(styles.calloutBody)}>
            <strong>
              招待された方は、Ripsへのログイン時に Google
              カレンダーへの追加アクセス権限を求められます。
            </strong>
            <br />
            <span {...stylex.props(styles.calloutBodySoft)}>
              「すべてのカレンダーの予定の表示と編集」を許可することで、空き時間の自動検出と予約の登録ができるようになります。
            </span>
          </div>
        </div>

        <div {...stylex.props(styles.expiryNote)}>
          <Clock size={13} aria-hidden="true" />
          <span>
            招待メールは <strong {...stylex.props(styles.expiryStrong)}>24時間</strong>
            有効です。期限切れの場合は再送できます。
          </span>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button" disabled={submitting}>
              キャンセル
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="primary"
            disabled={submitDisabled}
            loading={submitting}
            leftIcon={<Send size={15} aria-hidden="true" />}
            onClick={handleSubmit}
            data-testid="invite-submit"
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
