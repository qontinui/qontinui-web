"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import { searchUsers, type UserSummary } from "@/lib/api/strategy";

import { useUserCache } from "./use-user-cache";

/**
 * Markdown textarea + `@`-mention autocomplete.
 *
 * Autocomplete trigger: the most-recent `@` after a whitespace/newline
 * boundary, captured up to the cursor. Debounced 250ms; max 10 results
 * from `/api/v1/users/search`. Selection inserts the marker
 * `@[user_id:<uuid>]` (NOT the visible username) so the persisted form
 * is stable across renames; render-time resolution lives in
 * `<MentionMarker>`.
 */
export interface PostComposerProps {
  initialValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
  busy?: boolean;
  onSubmit: (body_markdown: string) => Promise<void> | void;
  onCancel?: () => void;
}

interface MentionContext {
  prefix: string;
  start: number; // index of the `@` in `value`
  caret: number; // current caret
}

const DEBOUNCE_MS = 250;

export function PostComposer({
  initialValue = "",
  submitLabel = "Post",
  cancelLabel,
  placeholder = "Write a comment… use @ to mention someone",
  busy = false,
  onSubmit,
  onCancel,
}: PostComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [mention, setMention] = useState<MentionContext | null>(null);
  const [results, setResults] = useState<UserSummary[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { merge } = useUserCache();

  // -- mention scanner ---------------------------------------------------

  const detectMention = useCallback(
    (text: string, caret: number): MentionContext | null => {
      // Walk backwards from caret until we find @ or whitespace.
      let i = caret - 1;
      while (i >= 0) {
        const ch = text.charAt(i);
        if (ch === "@") {
          const before = i === 0 ? " " : text.charAt(i - 1);
          if (/\s/.test(before) || i === 0) {
            const prefix = text.slice(i + 1, caret);
            if (/^[A-Za-z0-9_.\-]*$/.test(prefix)) {
              return { prefix, start: i, caret };
            }
          }
          return null;
        }
        if (/\s/.test(ch)) return null;
        i -= 1;
      }
      return null;
    },
    []
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setValue(next);
      const caret = e.target.selectionStart ?? next.length;
      const ctx = detectMention(next, caret);
      setMention(ctx);
      setActiveIdx(0);
      if (!ctx) setResults([]);
    },
    [detectMention]
  );

  // -- debounced search --------------------------------------------------

  useEffect(() => {
    if (!mention) return;
    const handle = setTimeout(async () => {
      if (mention.prefix.length === 0) {
        setResults([]);
        return;
      }
      try {
        const hits = await searchUsers(mention.prefix, 10);
        setResults(hits);
        // Prime the cache so render-time resolution is synchronous.
        merge(hits);
      } catch {
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [mention, merge]);

  // -- insertion ---------------------------------------------------------

  const insertMarker = useCallback(
    (user: UserSummary) => {
      if (!mention) return;
      const marker = `@[user_id:${user.id}]`;
      const before = value.slice(0, mention.start);
      const after = value.slice(mention.caret);
      const next = `${before}${marker} ${after}`;
      setValue(next);
      setMention(null);
      setResults([]);
      // Restore caret just past the marker + trailing space.
      const newCaret = before.length + marker.length + 1;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(newCaret, newCaret);
        }
      });
    },
    [mention, value]
  );

  // -- keyboard handling -------------------------------------------------

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention && results.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % results.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + results.length) % results.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const chosen = results[activeIdx];
          if (chosen) insertMarker(chosen);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMention(null);
          setResults([]);
          return;
        }
      }
      // Ctrl/Cmd-Enter submit shortcut.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mention, results, activeIdx, insertMarker]
  );

  // -- submit ------------------------------------------------------------

  const submit = useCallback(async () => {
    const body = value.trim();
    if (!body || busy) return;
    try {
      await onSubmit(body);
      setValue("");
    } catch {
      // Parent already toasts on failure — swallow here so React/Vitest
      // don't see an unhandled rejection bubble out of the click handler.
    }
  }, [value, busy, onSubmit]);

  const showSuggestions = mention !== null && results.length > 0;
  const containerCls = useMemo(() => "relative w-full", []);

  return (
    <div className={containerCls}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        data-testid="post-composer-textarea"
        disabled={busy}
      />
      {showSuggestions && (
        <ul
          role="listbox"
          aria-label="Mention suggestions"
          data-testid="mention-suggestions"
          className="absolute z-10 mt-1 w-72 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {results.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => insertMarker(u)}
                onMouseEnter={() => setActiveIdx(i)}
                data-testid={`mention-option-${u.id}`}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-sm hover:bg-accent",
                  i === activeIdx && "bg-accent"
                )}
              >
                <span className="font-medium">@{u.display}</span>
                {u.display !== u.email && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {u.email}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || value.trim().length === 0}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          data-testid="post-composer-submit"
        >
          {busy ? "Sending…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            {cancelLabel ?? "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
