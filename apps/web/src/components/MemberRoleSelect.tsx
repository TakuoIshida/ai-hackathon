import { useAuth } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { MembershipRole } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  wrapper: { display: "flex", flexDirection: "column", gap: space.xs },
  badge: {
    display: "inline-block",
    fontSize: "0.7rem",
    padding: "0.125rem 0.4rem",
    borderRadius: "999px",
    backgroundColor: colors.accent,
    color: colors.accentFg,
    width: "fit-content",
  },
  select: {
    fontSize: "0.875rem",
    padding: "0.25rem 0.5rem",
    border: `1px solid ${colors.border}`,
    borderRadius: "0.25rem",
    backgroundColor: colors.bg,
    color: colors.fg,
  },
  error: { color: colors.destructive, fontSize: "0.75rem" },
});

type Member = { userId: string; role: MembershipRole };

export type MemberRoleSelectProps = {
  workspaceId: string;
  member: Member;
  canEdit: boolean;
  onChanged?: () => void;
};

const ROLE_LABELS: Record<MembershipRole, string> = {
  owner: "owner",
  member: "member",
};

/**
 * ISH-111 standalone role switcher. Pure presentational unit:
 *  - `canEdit=false` → renders the role as a read-only badge.
 *  - `canEdit=true`  → renders a `<select>`. On change, calls
 *    `api.changeMemberRole` and invokes `onChanged` on success. A 409
 *    `last_owner` is rendered inline; `onChanged` is NOT called.
 *
 * Independently usable; ISH-110 will wire it into the members list in a
 * follow-up integration PR (out of scope for this PR).
 */
export function MemberRoleSelect({
  workspaceId,
  member,
  canEdit,
  onChanged,
}: MemberRoleSelectProps) {
  const { getToken } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <span {...stylex.props(styles.badge)} data-testid="role-badge">
        {ROLE_LABELS[member.role]}
      </span>
    );
  }

  const onChange = async (next: MembershipRole) => {
    if (next === member.role) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.changeMemberRole(workspaceId, member.userId, next, () => getToken());
      if (result.noop) {
        // Server signaled no change — still consider this a successful
        // transition for the purposes of UI refresh.
      }
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 && err.code === "last_owner") {
          setError("最後の owner は降格できません");
        } else {
          setError(`${err.status} ${err.code}`);
        }
      } else {
        setError("failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...stylex.props(styles.wrapper)}>
      <select
        {...stylex.props(styles.select)}
        aria-label="role"
        value={member.role}
        disabled={saving}
        onChange={(e) => {
          void onChange(e.target.value as MembershipRole);
        }}
      >
        <option value="owner">owner</option>
        <option value="member">member</option>
      </select>
      {error && <span {...stylex.props(styles.error)}>{error}</span>}
    </div>
  );
}

export default MemberRoleSelect;
