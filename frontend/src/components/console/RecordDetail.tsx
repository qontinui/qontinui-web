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
      {raw}
    </div>
  );
}
