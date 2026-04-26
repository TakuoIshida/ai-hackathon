import { useAuth, useUser } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { MemberRoleSelect } from "@/components/MemberRoleSelect";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/types";
import { colors, space } from "@/styles/tokens.stylex";

const styles = stylex.create({
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
  rowMeta: { display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: 0 },
  rowTitle: { fontSize: "0.875rem", fontWeight: 500 },
  rowSub: {
    fontSize: "0.75rem",
    color: colors.muted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: { fontSize: "0.875rem", color: colors.muted },
  error: { color: colors.destructive, fontSize: "0.875rem" },
});

type MembersData = {
  members: WorkspaceMember[];
  callerRole: WorkspaceRole;
};

export type WorkspaceMembersProps = {
  workspaceId: string;
};

/**
 * ISH-110: workspace members section. Shows the member list and lets owners
 * remove members. The caller's own row never shows a delete button (matching
 * the server-side `cannot_remove_self_owner` guard); we identify the caller
 * by their Clerk primary email — DB user emails are sourced from Clerk and
 * stay in sync via the webhook.
 */
export default function WorkspaceMembers({ workspaceId }: WorkspaceMembersProps) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const callerEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;

  const [data, setData] = useState<MembersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMembers(workspaceId, () => getToken());
      setData({ members: res.members, callerRole: res.callerRole });
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRemove = async (member: WorkspaceMember) => {
    if (!confirm(`${member.name ?? member.email} をワークスペースから削除しますか？`)) return;
    setRemovingUserId(member.userId);
    setError(null);
    try {
      await api.removeMember(workspaceId, member.userId, () => getToken());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.status} ${err.code}` : "failed to remove");
    } finally {
      setRemovingUserId(null);
    }
  };

  if (loading) return <p {...stylex.props(styles.empty)}>読み込み中...</p>;
  if (error && !data) return <p {...stylex.props(styles.error)}>{error}</p>;
  if (!data) return null;
  if (data.members.length === 0) {
    return <p {...stylex.props(styles.empty)}>メンバーがいません。</p>;
  }

  return (
    <>
      {error && <p {...stylex.props(styles.error)}>{error}</p>}
      <div {...stylex.props(styles.list)}>
        {data.members.map((m) => {
          const isSelf = callerEmail !== null && m.email.toLowerCase() === callerEmail;
          const canDelete = data.callerRole === "owner" && !isSelf;
          // ISH-111 integration: owners can change anyone else's role; their
          // own row stays read-only (use the dedicated PATCH-self flow when
          // it exists). Members never see the editor.
          const canEditRole = data.callerRole === "owner" && !isSelf;
          const removing = removingUserId === m.userId;
          return (
            <div key={m.userId} {...stylex.props(styles.row)}>
              <div {...stylex.props(styles.rowMeta)}>
                <span {...stylex.props(styles.rowTitle)}>{m.name ?? m.email}</span>
                <span {...stylex.props(styles.rowSub)}>{m.email}</span>
              </div>
              <MemberRoleSelect
                workspaceId={workspaceId}
                member={{ userId: m.userId, role: m.role }}
                canEdit={canEditRole}
                onChanged={() => {
                  void load();
                }}
              />
              {canDelete ? (
                <Button variant="destructive" onClick={() => onRemove(m)} disabled={removing}>
                  {removing ? "削除中..." : "削除"}
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
