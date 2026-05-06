import * as stylex from "@stylexjs/stylex";
import { Mail, X } from "lucide-react";
import * as React from "react";
import { colors, radius, space, typography } from "@/styles/tokens.stylex";

// ---------------------------------------------------------------------------
// EmailChipsInput (ISH-234)
//
// 招待モーダル (M-02) で利用する複数 email 入力。chip 表示 + 区切り文字 (
// カンマ / スペース / セミコロン / 改行 / タブ) 対応 + paste 一括追加 +
// backspace で末尾 chip 削除 + 簡易 regex で invalid 表示。
// ---------------------------------------------------------------------------

/**
 * Simple-but-good-enough email regex.
 * Spec: 1+ non-whitespace/non-@, "@", 1+ non-whitespace/non-@, ".",
 * 1+ non-whitespace/non-@. Matches RFC for the 99% case without overreach.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whitespace + comma + semicolon split — matches paste / inline separators. */
const SPLIT_RE = /[,;\s]+/;

export const isValidEmail = (raw: string): boolean => EMAIL_RE.test(raw);

const styles = stylex.create({
  container: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-start",
    alignContent: "flex-start",
    gap: space.xs,
    minHeight: "6.5rem",
    width: "100%",
    paddingInline: space.sm,
    paddingBlock: space.sm,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    cursor: "text",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "120ms",
  },
  containerFocused: {
    borderColor: colors.blue500,
    boxShadow: `0 0 0 3px rgba(79, 146, 190, 0.18)`,
  },
  containerDisabled: {
    backgroundColor: colors.bgSoft,
    cursor: "not-allowed",
    opacity: 0.7,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    paddingInlineStart: space.sm,
    paddingInlineEnd: space.xs,
    paddingBlock: "0.125rem",
    borderRadius: radius.full,
    backgroundColor: colors.blue100,
    color: colors.blue800,
    fontSize: typography.fontSizeSm,
    fontFamily: typography.fontFamilySans,
    border: `1px solid transparent`,
    maxWidth: "100%",
  },
  chipInvalid: {
    backgroundColor: colors.rose100,
    color: colors.rose500,
    borderColor: colors.rose500,
  },
  chipText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chipRemove: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.125rem",
    height: "1.125rem",
    padding: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    borderRadius: radius.full,
    cursor: "pointer",
    flexShrink: 0,
  },
  input: {
    flex: "1 1 8rem",
    minWidth: "8rem",
    border: "none",
    outline: "none",
    backgroundColor: "transparent",
    fontFamily: typography.fontFamilySans,
    fontSize: typography.fontSizeSm,
    color: colors.fg,
    padding: 0,
    height: "1.75rem",
  },
  hint: {
    marginBlockStart: space.xs,
    fontSize: typography.fontSizeXs,
    color: colors.muted,
  },
});

export interface EmailChipsInputProps {
  /** Current chips (array of email strings). */
  value: string[];
  /** Called whenever the chips array changes. */
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Hint text shown below the input. Pass `null` to suppress. */
  hint?: React.ReactNode;
  "aria-label"?: string;
  id?: string;
}

const DEFAULT_HINT = "カンマ・スペース・改行で複数のメールアドレスをまとめて入力できます";

/**
 * Split a raw paste / draft string into trimmed candidate emails.
 * Empty fragments are discarded; duplicates are kept (caller decides dedup).
 */
const splitEmails = (raw: string): string[] =>
  raw
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export const EmailChipsInput = React.forwardRef<HTMLInputElement, EmailChipsInputProps>(
  (
    {
      value,
      onChange,
      placeholder = "name@example.com",
      disabled = false,
      hint = DEFAULT_HINT,
      "aria-label": ariaLabel,
      id,
    },
    ref,
  ) => {
    const [draft, setDraft] = React.useState("");
    const [focused, setFocused] = React.useState(false);
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const commit = (rawCandidates: string[]) => {
      if (rawCandidates.length === 0) return;
      onChange([...value, ...rawCandidates]);
    };

    const handleContainerMouseDown = (e: React.MouseEvent<HTMLLabelElement>) => {
      if (disabled) return;
      // Don't preventDefault when clicking a chip's remove button — that
      // button needs to receive the click to fire its onClick.
      if ((e.target as HTMLElement).closest("button")) return;
      // Don't preventDefault when the click already targets the inner input
      // (e.g. caret positioning by clicking inside the input itself).
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      // Otherwise, route the focus to the inner input so the whole rounded
      // box behaves as a single text field. preventDefault avoids losing the
      // existing selection mid-edit.
      e.preventDefault();
      inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      const trimmed = draft.trim();
      // Separator keys → commit current draft.
      if (e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
        if (trimmed.length > 0) {
          e.preventDefault();
          commit(splitEmails(trimmed));
          setDraft("");
        }
        return;
      }
      // Space-as-separator (only when draft non-empty; otherwise allow free space).
      if (e.key === " " && trimmed.length > 0) {
        e.preventDefault();
        commit(splitEmails(trimmed));
        setDraft("");
        return;
      }
      // Backspace on empty draft → pop last chip.
      if (e.key === "Backspace" && draft.length === 0 && value.length > 0) {
        e.preventDefault();
        onChange(value.slice(0, -1));
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;
      const next = e.target.value;
      // If the input contains a separator, split on it: commit completed
      // tokens and keep the trailing fragment as the new draft.
      if (SPLIT_RE.test(next)) {
        const parts = next.split(SPLIT_RE);
        const tail = parts.pop() ?? "";
        const completed = parts.map((s) => s.trim()).filter((s) => s.length > 0);
        if (completed.length > 0) commit(completed);
        setDraft(tail);
        return;
      }
      setDraft(next);
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (disabled) return;
      const pasted = e.clipboardData.getData("text");
      if (!pasted) return;
      // If paste has any separator OR comes alongside an existing draft,
      // bulk-commit the union and clear the draft. Otherwise let the default
      // paste path append into the draft.
      if (SPLIT_RE.test(pasted) || draft.length > 0) {
        e.preventDefault();
        const combined = `${draft} ${pasted}`;
        commit(splitEmails(combined));
        setDraft("");
      }
    };

    const handleBlur = () => {
      setFocused(false);
      const trimmed = draft.trim();
      if (trimmed.length > 0) {
        commit(splitEmails(trimmed));
        setDraft("");
      }
    };

    const removeAt = (idx: number) => {
      if (disabled) return;
      onChange(value.filter((_, i) => i !== idx));
      inputRef.current?.focus();
    };

    const containerSx = stylex.props(
      styles.container,
      focused && !disabled && styles.containerFocused,
      disabled && styles.containerDisabled,
    );

    return (
      <div>
        {/* Wrapping <label> means click anywhere → focus the inner <input>
            without us touching click/key events directly (it's the native
            label-click behaviour of HTML). The chips and remove buttons
            sit inside the label and remain individually clickable. */}
        <label
          onMouseDown={handleContainerMouseDown}
          className={containerSx.className}
          style={containerSx.style}
        >
          {value.map((email, idx) => {
            const invalid = !isValidEmail(email);
            const chipSx = stylex.props(styles.chip, invalid && styles.chipInvalid);
            const removeSx = stylex.props(styles.chipRemove);
            const textSx = stylex.props(styles.chipText);
            // emails may legitimately duplicate (user pastes the same address
            // twice); pairing index with email keeps a stable identity through
            // chip removal without colliding on duplicates.
            const chipKey = `${idx}-${email}`;
            return (
              <span
                key={chipKey}
                className={chipSx.className}
                style={chipSx.style}
                data-invalid={invalid || undefined}
                data-testid="email-chip"
              >
                <Mail size={12} aria-hidden />
                <span className={textSx.className} style={textSx.style}>
                  {email}
                </span>
                <button
                  type="button"
                  className={removeSx.className}
                  style={removeSx.style}
                  aria-label={`メールアドレス ${email} を削除`}
                  onClick={() => removeAt(idx)}
                  disabled={disabled}
                  tabIndex={disabled ? -1 : 0}
                >
                  <X size={11} aria-hidden />
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            id={id}
            type="text"
            value={draft}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            placeholder={value.length === 0 ? placeholder : undefined}
            disabled={disabled}
            aria-label={ariaLabel ?? "メールアドレス"}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={stylex.props(styles.input).className}
            style={stylex.props(styles.input).style}
          />
        </label>
        {hint != null && hint !== false && (
          <p
            className={stylex.props(styles.hint).className}
            style={stylex.props(styles.hint).style}
          >
            {hint}
          </p>
        )}
      </div>
    );
  },
);

EmailChipsInput.displayName = "EmailChipsInput";
