import * as stylex from "@stylexjs/stylex";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Link as LinkIcon,
} from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { colors, space, typography } from "@/styles/tokens.stylex";

/**
 * Link 作成画面 (calendar / form 両 mode 共通) の chrome — subnav + 2 列 grid。
 *
 * - subnav: 戻る ボタン + breadcrumb + SegmentedControl + 下書き保存 / 発行 ボタン
 * - body: 左 main (children) + 右 settings panel (rightPanel slot)
 *
 * 親の DashboardLayout が `<main>` に padding: space.xl を当てているため、
 * 全幅 subnav を実現すべく `marginInline` / `marginBlockStart` で打ち消す。
 *
 * `rightPanelWidth` は mode により 380 (calendar) / 460 (form) を切り替える想定。
 */

export type LinkMode = "calendar" | "form";

export interface LinkCreateLayoutProps {
  /** Currently active mode (controlled). */
  mode: LinkMode;
  /** Mode change handler. */
  onModeChange: (next: LinkMode) => void;
  /** Visible right panel — typically <SettingsPanel />. */
  rightPanel: React.ReactNode;
  /** Right panel width in pixels. calendar=380, form=460. */
  rightPanelWidth?: number;
  /** Body content for the left main area. */
  children: React.ReactNode;
  /** Back button click — navigate to list page. */
  onBack: () => void;
  /** Draft save click. Not yet wired in the scaffolding stage. */
  onSaveDraft?: () => void;
  /** Publish click — submits the form / persists. */
  onPublish: () => void;
  /** True while publish is in flight. */
  publishing?: boolean;
  /** Disable the publish button (e.g. slug taken). */
  publishDisabled?: boolean;
  /** Breadcrumb tail label (e.g. "新規作成" / "編集"). */
  title: string;
}

const styles = stylex.create({
  // Negate parent padding (`space.xl` = 2rem in DashboardLayout) so subnav
  // spans full width and body fills the remaining viewport. If the layout is
  // ever embedded inside a non-padded container, the negative margins are
  // harmless (clamped by the parent edge).
  shell: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    marginInline: "-2rem",
    marginBlockStart: "-2rem",
    marginBlockEnd: "-2rem",
  },
  subnav: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    paddingInline: "2.5rem",
    paddingBlock: "0.75rem",
    backgroundColor: colors.bg,
    borderBottom: `1px solid ${colors.ink200}`,
  },
  divider: {
    width: "1px",
    height: "1.125rem",
    backgroundColor: colors.ink200,
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    fontSize: typography.fontSizeSm,
  },
  breadcrumbMuted: {
    color: colors.ink500,
  },
  breadcrumbActive: {
    color: colors.blue900,
    fontWeight: typography.fontWeightBold,
  },
  spacer: {
    marginInlineStart: "auto",
    display: "flex",
    alignItems: "center",
    gap: space.sm,
  },
  body: {
    flex: 1,
    display: "grid",
    minHeight: 0,
    overflow: "hidden",
  },
  main: {
    overflowY: "auto",
    padding: "1.25rem 1.5rem",
    backgroundColor: colors.bgPage,
  },
  panel: {
    overflowY: "auto",
    padding: "1.5rem",
    backgroundColor: colors.bg,
    borderInlineStart: `1px solid ${colors.ink200}`,
  },
});

const MODE_OPTIONS = [
  {
    value: "calendar" as const,
    label: "カレンダーで選択",
    icon: <CalendarIcon size={13} aria-hidden="true" />,
  },
  {
    value: "form" as const,
    label: "曜日×時間帯",
  },
];

export function LinkCreateLayout({
  mode,
  onModeChange,
  rightPanel,
  rightPanelWidth = 380,
  children,
  onBack,
  onSaveDraft,
  onPublish,
  publishing = false,
  publishDisabled = false,
  title,
}: LinkCreateLayoutProps) {
  const bodyStyle: React.CSSProperties = {
    gridTemplateColumns: `1fr ${rightPanelWidth}px`,
  };
  return (
    <div {...stylex.props(styles.shell)}>
      <div {...stylex.props(styles.subnav)}>
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          leftIcon={<ChevronLeft size={14} aria-hidden="true" />}
        >
          戻る
        </Button>
        <span {...stylex.props(styles.divider)} aria-hidden="true" />
        <div {...stylex.props(styles.breadcrumb)}>
          <span {...stylex.props(styles.breadcrumbMuted)}>空き時間リンク</span>
          <ChevronRight size={12} aria-hidden="true" color={colors.ink400} />
          <span {...stylex.props(styles.breadcrumbActive)}>{title}</span>
        </div>
        <div {...stylex.props(styles.spacer)}>
          <SegmentedControl
            value={mode}
            onChange={onModeChange}
            options={MODE_OPTIONS}
            aria-label="入力モード"
          />
          <Button variant="ghost" size="sm" onClick={onSaveDraft} disabled={!onSaveDraft}>
            下書き保存
          </Button>
          <Button
            onClick={onPublish}
            loading={publishing}
            disabled={publishDisabled}
            leftIcon={<LinkIcon size={15} aria-hidden="true" />}
          >
            リンクを発行
          </Button>
        </div>
      </div>
      <div {...stylex.props(styles.body)} style={bodyStyle}>
        <div {...stylex.props(styles.main)}>{children}</div>
        <aside {...stylex.props(styles.panel)} aria-label="リンク設定">
          {rightPanel}
        </aside>
      </div>
    </div>
  );
}
