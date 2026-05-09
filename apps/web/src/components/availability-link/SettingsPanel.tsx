import * as stylex from "@stylexjs/stylex";
import { Link as LinkIcon, Plus, User as UserIcon, Video } from "lucide-react";
import * as React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DurationPicker } from "@/components/ui/duration-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { LinkInput } from "@/lib/types";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";
import { AcceptanceSummary } from "./AcceptanceSummary";

/**
 * Right-side settings panel shown next to the calendar / form mode body.
 *
 * 4 fields のみ:
 *  1. タイトル (text)
 *  2. 所要時間 (DurationPicker)
 *  3. 場所 (RadioGroup — Google Meet / 対面 / カスタムURL)
 *  4. 参加者 (主催者 chip + 共催者追加 placeholder button)
 *
 * 場所選択は本 issue では UI のみで、`LinkInput` には永続化しない (フィールド未定)。
 * 後続 issue で `LinkInput.locationKind` 等が増えた段階で拡張する。
 */

export type LocationKind = "meet" | "in-person" | "custom";

export interface SettingsPanelProps {
  form: LinkInput;
  onChange: (patch: Partial<LinkInput>) => void;
  /** Currently selected location kind. Local-only state for the moment. */
  location?: LocationKind;
  onLocationChange?: (next: LocationKind) => void;
  /** Display name shown on the host chip. Falls back to "主催者". */
  hostName?: string;
  /** Initial used by the host avatar (1 char). */
  hostInitial?: string;
  /** When true, show the form-mode 受付サマリー card at the bottom (ISH-244). */
  showAcceptanceSummary?: boolean;
}

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.lg,
  },
  sectionTitle: {
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightBold,
    color: colors.ink500,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    margin: 0,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: space.xs,
  },
  fieldLabel: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.ink700,
  },
  locationGroup: {
    display: "flex",
    flexDirection: "column",
    gap: space.sm,
  },
  locationItem: {
    display: "flex",
    alignItems: "center",
    gap: space.sm,
    padding: "0.625rem 0.75rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.ink200,
    borderRadius: radius.md,
    cursor: "pointer",
    backgroundColor: colors.bg,
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
  },
  locationItemActive: {
    backgroundColor: colors.blue50,
    borderColor: colors.blue500,
    borderWidth: "1.5px",
  },
  locationItemDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  locationBody: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.125rem",
  },
  locationTitle: {
    fontSize: typography.fontSizeSm,
    fontWeight: typography.fontWeightBold,
    color: colors.blue900,
  },
  locationSub: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
  },
  participants: {
    display: "flex",
    flexWrap: "wrap",
    gap: space.xs,
    alignItems: "center",
  },
  hostChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    padding: "0.3125rem 0.625rem 0.3125rem 0.3125rem",
    backgroundColor: colors.mint100,
    borderRadius: radius.full,
    fontSize: typography.fontSizeXs,
  },
});

const LOCATION_OPTIONS: ReadonlyArray<{
  value: LocationKind;
  label: string;
  description?: string;
  icon: React.ReactNode;
  optional?: boolean;
  disabled?: boolean;
}> = [
  {
    value: "meet",
    label: "Google Meet",
    description: "予約確定時に自動でURLを発行",
    icon: <Video size={16} aria-hidden="true" />,
    disabled: false,
  },
  {
    value: "in-person",
    label: "対面 / 場所を指定",
    description: "(近日対応)",
    icon: <UserIcon size={16} aria-hidden="true" />,
    disabled: true,
  },
  {
    value: "custom",
    label: "カスタムURL (Zoom等)",
    description: "(近日対応)",
    icon: <LinkIcon size={16} aria-hidden="true" />,
    optional: true,
    disabled: true,
  },
];

export function SettingsPanel({
  form,
  onChange,
  location = "meet",
  onLocationChange,
  hostName = "主催者",
  hostInitial = "H",
  showAcceptanceSummary = false,
}: SettingsPanelProps) {
  const titleId = React.useId();
  const durationId = React.useId();

  return (
    <div {...stylex.props(styles.root)}>
      <h2 {...stylex.props(styles.sectionTitle)}>リンクの設定</h2>

      {/* 1. Title */}
      <div {...stylex.props(styles.field)}>
        <Label htmlFor={titleId}>タイトル</Label>
        <Input
          id={titleId}
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="タイトルを入力してください"
        />
      </div>

      {/* 2. Duration */}
      <div {...stylex.props(styles.field)}>
        <span id={durationId} {...stylex.props(styles.fieldLabel)}>
          所要時間
        </span>
        <DurationPicker
          value={form.durationMinutes}
          onChange={(m) => onChange({ durationMinutes: m })}
          aria-label="所要時間"
        />
      </div>

      {/* 3. Location */}
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.fieldLabel)}>場所</span>
        <RadioGroup
          value={location}
          onValueChange={(v) => onLocationChange?.(v as LocationKind)}
          aria-label="場所"
        >
          <div {...stylex.props(styles.locationGroup)}>
            {LOCATION_OPTIONS.map((opt) => {
              const active = opt.value === location;
              const itemSx = stylex.props(
                styles.locationItem,
                active && styles.locationItemActive,
                opt.disabled && styles.locationItemDisabled,
              );
              return (
                // biome-ignore lint/a11y/noLabelWithoutControl: label wraps the RadioGroupItem button below
                <label key={opt.value} className={itemSx.className} style={itemSx.style}>
                  <RadioGroupItem
                    value={opt.value}
                    aria-label={opt.label}
                    disabled={opt.disabled}
                  />
                  {opt.icon}
                  <div {...stylex.props(styles.locationBody)}>
                    <span {...stylex.props(styles.locationTitle)}>{opt.label}</span>
                    {opt.description && (
                      <span {...stylex.props(styles.locationSub)}>{opt.description}</span>
                    )}
                  </div>
                  {opt.optional && <Badge>任意</Badge>}
                </label>
              );
            })}
          </div>
        </RadioGroup>
      </div>

      {/* 4. Participants */}
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.fieldLabel)}>参加者</span>
        <div {...stylex.props(styles.participants)}>
          <span {...stylex.props(styles.hostChip)}>
            <Avatar size="sm">
              <AvatarFallback>{hostInitial}</AvatarFallback>
            </Avatar>
            {hostName}
            <Badge>主催者</Badge>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            leftIcon={<Plus size={13} aria-hidden="true" />}
          >
            共催者を追加
          </Button>
        </div>
      </div>

      {/* 5. Acceptance summary (form mode only — ISH-244) */}
      {showAcceptanceSummary && (
        <AcceptanceSummary rules={form.rules} durationMinutes={form.durationMinutes} />
      )}
    </div>
  );
}
