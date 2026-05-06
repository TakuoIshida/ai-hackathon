import * as stylex from "@stylexjs/stylex";
import * as React from "react";
import { colors, radius, typography } from "@/styles/tokens.stylex";

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
  },
  group: {
    display: "inline-flex",
    alignItems: "center",
  },
  avatar: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radius.full,
    border: `2px solid ${colors.bg}`,
    boxSizing: "border-box",
    flexShrink: 0,
    fontFamily: typography.fontFamilySans,
    fontWeight: typography.fontWeightMedium,
    color: colors.ink700,
    backgroundColor: colors.ink100,
  },
  // size: sm — Spir 系の links list と一致 (26px / fontSize 10px)。
  sizeSm: {
    width: "1.625rem",
    height: "1.625rem",
    fontSize: "0.625rem",
  },
  // size: md — 30px / fontSize 12px。
  sizeMd: {
    width: "1.875rem",
    height: "1.875rem",
    fontSize: "0.75rem",
  },
  // 2 件目以降は重ねる。
  overlap: {
    marginLeft: "-0.375rem",
  },
  image: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  overflow: {
    backgroundColor: colors.ink200,
    color: colors.ink700,
  },
  count: {
    fontSize: typography.fontSizeXs,
    color: colors.ink500,
  },
});

const sizeMap = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
} as const;

export interface AvatarStackMember {
  name: string;
  color?: string;
  image?: string;
}

export interface AvatarStackProps extends React.HTMLAttributes<HTMLDivElement> {
  members: AvatarStackMember[];
  max?: number;
  size?: keyof typeof sizeMap;
  showCount?: boolean;
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  // 半角スペースか日本語の "・" 区切りで分割。1 トークンなら先頭 2 文字。
  const parts = trimmed.split(/[\s・]+/u).filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  if (parts.length === 1) {
    // Array.from で surrogate pair / 結合文字を 1 単位として扱う。
    const chars = Array.from(parts[0] ?? "");
    return chars.slice(0, 2).join("").toUpperCase();
  }
  const first = Array.from(parts[0] ?? "")[0] ?? "";
  const second = Array.from(parts[1] ?? "")[0] ?? "";
  return (first + second).toUpperCase();
}

export const AvatarStack = React.forwardRef<HTMLDivElement, AvatarStackProps>(
  ({ members, max = 3, size = "sm", showCount = true, style, ...props }, ref) => {
    const total = members.length;
    const visible = total > max ? members.slice(0, max) : members;
    const overflow = total > max ? total - max : 0;
    const sizeStyle = sizeMap[size];
    const sx = stylex.props(styles.root);

    // 同名重複も許す前提で stable な key を作るため、name + 元配列の通し番号を
    // 結合する (overflow による slice 後も original index が変わらないように
    // entries 化して持つ)。
    const visibleEntries: Array<[number, AvatarStackMember]> = visible.map((m, i) => [i, m]);

    return (
      <div ref={ref} {...props} className={sx.className} style={{ ...sx.style, ...style }}>
        <div {...stylex.props(styles.group)}>
          {visibleEntries.map(([i, m]) => {
            const itemSx = stylex.props(styles.avatar, sizeStyle, i > 0 && styles.overlap);
            const bg = m.color;
            return (
              <span
                key={`${i}-${m.name}`}
                role="img"
                aria-label={m.name}
                title={m.name}
                className={itemSx.className}
                style={{ ...itemSx.style, ...(bg ? { backgroundColor: bg } : null) }}
              >
                {m.image ? (
                  <img src={m.image} alt="" {...stylex.props(styles.image)} />
                ) : (
                  getInitials(m.name)
                )}
              </span>
            );
          })}
          {overflow > 0 && (
            <span
              role="img"
              aria-label={`他 ${overflow} 名`}
              {...stylex.props(styles.avatar, sizeStyle, styles.overlap, styles.overflow)}
            >
              +{overflow}
            </span>
          )}
        </div>
        {showCount && total > 0 && <span {...stylex.props(styles.count)}>{total}名</span>}
      </div>
    );
  },
);
AvatarStack.displayName = "AvatarStack";
