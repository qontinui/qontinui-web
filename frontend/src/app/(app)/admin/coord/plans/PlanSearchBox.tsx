"use client";

/**
 * The `/admin/coord/plans` search box — SERVER-side, unlike every other
 * filter on the page.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 2.
 * It sends `q` to `GET /plan-library/reconciliation`, which filters the stem
 * population BEFORE paging (so `total` is the match count) with the same
 * semantics as the library list route: full text over title and body, OR a
 * literal substring of the slug — so a pasted filename such as
 * `devops-unfiltered-push-trigger` finds its plan.
 *
 * Typing is debounced ({@link SEARCH_DEBOUNCE_MS}): each keystroke would
 * otherwise re-run a three-way join over the whole corpus. Clearing is a
 * discrete action and applies at once.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const SEARCH_DEBOUNCE_MS = 300;

export function PlanSearchBox({
  applied,
  onSearch,
}: {
  /** The search currently in force (what the page last sent). */
  applied: string;
  /** Called with the trimmed text once typing settles. */
  onSearch: (q: string) => void;
}) {
  const [typed, setTyped] = useState(applied);
  const lastApplied = useRef(applied);

  // `applied` changed from OUTSIDE (not by this box's own debounce): follow it
  // — but only when the box holds no edit of its own. An in-progress edit
  // (text that differs from the search that was in force) wins, so this never
  // fights the operator's typing; its debounce then applies it.
  useEffect(() => {
    const previous = lastApplied.current;
    lastApplied.current = applied;
    if (applied === previous) return;
    setTyped((current) => (current.trim() === previous ? applied : current));
  }, [applied]);

  useEffect(() => {
    const next = typed.trim();
    if (next === applied) return;
    const id = setTimeout(() => onSearch(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed, applied, onSearch]);

  return (
    <div className="relative min-w-[220px] flex-1">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        className="pl-8 pr-8"
        placeholder="Search plans — title, body, or a pasted slug…"
        aria-label="Search plans"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        data-testid="coord-plans-search"
        title="Server-side: the route filters the whole corpus before paging, so the total below is the number of matches."
      />
      {typed !== "" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-0.5 top-1/2 h-7 -translate-y-1/2 px-2"
          onClick={() => {
            setTyped("");
            onSearch("");
          }}
          aria-label="Clear search"
          data-testid="coord-plans-search-clear"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

/**
 * What the route says it searched for — the echo, or the absence of one.
 *
 * A backend that predates server-side search ignores `q` and echoes nothing,
 * so its rows are the UNFILTERED window. Rendering them under the search box
 * as though they matched would be a silent mislabel; this says so instead.
 */
export function SearchEcho({
  sent,
  echoed,
}: {
  /** What the page sent ("" for no search). */
  sent: string;
  /** The response's `q` — `undefined` when the key is absent. */
  echoed: string | null | undefined;
}) {
  if (sent === "") return null;
  if (echoed === undefined) {
    return (
      <p
        className="text-xs text-amber-200"
        data-testid="coord-plans-search-not-applied"
      >
        This backend did not echo the search, so it most likely ignored it — the
        rows below are NOT filtered by &ldquo;{sent}&rdquo;.
      </p>
    );
  }
  if (echoed === null || echoed !== sent) {
    return (
      <p
        className="text-xs text-amber-200"
        data-testid="coord-plans-search-mismatch"
      >
        The route applied{" "}
        {echoed === null ? "no search" : <>&ldquo;{echoed}&rdquo;</>}, not
        &ldquo;{sent}&rdquo; — the rows below answer that, not what you typed.
      </p>
    );
  }
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid="coord-plans-search-echo"
    >
      Showing matches for &ldquo;<span className="font-mono">{echoed}</span>
      &rdquo; across the whole corpus (title, body, or slug) — the total below
      counts matches.
    </p>
  );
}
