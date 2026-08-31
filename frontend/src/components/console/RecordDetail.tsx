"use client";

/**
 * RecordDetail — the panel a click on a `<RecordRow>` earns.
 *
 * **Enforces R5 — "Detail expands in place."**
 * See `frontend/docs/console-ui-style-guide.md` §2 R5 and §3.2.
 *
 * Generalised out of `MergePipeline.tsx`'s `RowDetail` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1.
 *
 * Two things are fixed here and are not the caller's choice:
 *
 * 1. **It renders below the row it belongs to and shares its border**
 *    (`border-t-0 rounded-b-md`), so the row and its detail read as one
 *    object rather than as a row and a floating card. It is deliberately NOT a
 *    slide-over sheet (D2): clicking a record must do the same thing on every
 *    page of the console, and a full-width panel hosts everything a
 *    fixed-width sheet could.
 * 2. **The section ORDER**, which is the part reviewers otherwise re-litigate
 *    per page:
 *
 *    | slot | what belongs in it |
 *    |---|---|
 *    | `why` | plain-language why, first, in the operator's words |
 *    | `problems` | what failed — named checks, failing dimensions, evidence |
 *    | `actions` | buttons and links: the thing to DO, plus "Open full page ↗" |
 *    | `history` | prior attempts / occurrences, muted |
 *    | `raw` | raw ids, `font-mono text-[10px] text-muted-foreground/60`, LAST |
 *
 * Each slot is a `ReactNode` and renders as a bare fragment, so the container's
 * `space-y-3` spaces the real content nodes rather than five always-present
 * wrapper divs. An absent slot costs nothing and leaves no gap.
 *
 * R8 lives in the last row of that table: raw ids appear HERE and nowhere
 * else. A proposal id, a UUID, a `merge_state_status` enum is support
 * material, and a primary surface that shows it has leaked internal
 * vocabulary.
 */

import type { ReactNode } from "react";

/**
 * Would React render anything at all for this node?
 *
 * The wrapper below is conditional so an absent slot still leaves no gap, and
 * getting the condition slightly wrong reintroduces the gap in exactly the
 * cases nobody tests. React renders NOTHING for six values — `null`,
 * `undefined`, `true`, `false`, `""` and an empty array — and the tempting
 * `raw != null && raw !== false` covers three of them. The other three arrive
 * by ordinary means: `cond && <div/>` yields `false`, but `str && <div/>`
 * yields `""` when the string is empty, and `list.length > 0 && …` inside a
 * `||` chain can yield either. `<AlertRow>`'s `raw` is exactly that shape over
 * a `device_id` typed `string | null`.
 *
 * An empty wrapper is not visually free: it is a non-first child of a
 * `space-y-3` container, so it draws a 12px gap at the foot of every panel it
 * appears in.
 */
function rendersSomething(node: ReactNode): boolean {
  if (node == null || typeof node === "boolean" || node === "") return false;
  // Recursive, not `length > 0`: `[a && <X/>, b && <Y/>]` with both conditions
  // false is `[false, false]` — two entries, nothing rendered. No `raw=` call
  // site passes an array today, so this is the cheap way to keep the guard
  // honest rather than a fix for a live bug.
  if (Array.isArray(node)) return node.some(rendersSomething);
  return true;
}

export interface RecordDetailProps {
  /** Plain-language why. First, because it is what the click was for. */
  why?: ReactNode;
  /** What failed — named checks, evidence, the concrete problem. */
  problems?: ReactNode;
  /** What to do / where to look: buttons and links. */
  actions?: ReactNode;
  /** Prior attempts, occurrences, timeline. Muted. */
  history?: ReactNode;
  /** Raw ids for support. Always last, always muted mono. */
  raw?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function RecordDetail({
  why,
  problems,
  actions,
  history,
  raw,
  className,
  "data-testid": testId,
}: RecordDetailProps) {
  return (
    <div
      className={[
        "border border-t-0 border-border rounded-b-md bg-card px-4 py-3 space-y-3 text-sm",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      {why}
      {problems}
      {actions}
      {history}
      {/*
        The one slot that gets a wrapper, and only when it is occupied.
        `data-console-raw` is R8's slot made addressable: a style rule, a spec
        selector or a `/visual-audit` assertion can now find "the raw-ids
        block" instead of guessing at a class string. Rendered conditionally so
        the module doc's promise above still holds — an absent slot costs
        nothing and leaves no gap — and the wrapper is one child either way, so
        the container's `space-y-3` spaces it exactly as the bare node was.
      */}
      {rendersSomething(raw) && <div data-console-raw="">{raw}</div>}
    </div>
  );
}
