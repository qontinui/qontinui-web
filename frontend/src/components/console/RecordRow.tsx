"use client";

/**
 * RecordRow — one record, one line, click to expand.
 *
 * **Enforces R2 ("one record = one line") and R4 ("left-edge accent, not a
 * coloured row").** See `frontend/docs/console-ui-style-guide.md` §2 R2/R4 and
 * §3.2.
 *
 * Generalised out of `MergePipeline.tsx`'s `PipelineRowDisplay` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1. The
 * slot ORDER is the rule and it is fixed here rather than left to each caller:
 *
 *   identity badge (mono) → label (truncating, `flex-1`) → status badge →
 *   reason (`hidden sm:inline`, truncating) → time → chevron
 *
 * Overflow is truncation with a `title`, never wrapping — a wrapped row is
 * what makes a list unscannable, and it is the single easiest thing to get
 * wrong when a page grows a field.
 *
 * `status` and `time` are ReactNode SLOTS rather than typed data, deliberately:
 * each surface renders its own `<StatusBadge status palette={…}>` from
 * `./statusRow`, so the row primitive never needs to know a surface's kind
 * union or own a palette. `accent` is the class string from
 * `rowAccentClass(status)` — R4 lives in that function, and passing its result
 * keeps the row body neutral, which is what keeps 40 rows readable when 6 are
 * red.
 *
 * The whole line is ONE `<button>`: R5's "clicking the row expands it" has to
 * be reachable by keyboard, and a div with an onClick is not.
 */

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface RecordRowProps {
  /** Mono identity chip: `repo#123`, a worktree name, a drive letter. */
  identity: ReactNode;
  /** The primary label. Truncates; supply a `title` inside if it can overflow. */
  label: ReactNode;
  /** The status badge element, e.g. `<StatusBadge status palette />`. */
  status?: ReactNode;
  /**
   * Brief "why", shown inline from `sm` up and hidden while expanded (the
   * detail panel carries it in full). The status badge's own `title` is what
   * answers "why?" on the viewports where this is dropped.
   */
  reason?: string;
  /** The timestamp element, e.g. `<RowTime at verb />`. */
  time?: ReactNode;
  /** `rowAccentClass(status)` — R4's 2px left border, or "" for none. */
  accent?: string;
  expanded: boolean;
  onToggle: () => void;
  /**
   * The detail panel, rendered BELOW the row and only while expanded. Normally
   * a `<RecordDetail>`, which shares this row's border (`border-t-0
   * rounded-b-md`) so the two read as one object.
   */
  children?: ReactNode;
  /** Written to `data-row-key` — the row's stable identity for e2e/specs. */
  rowKey?: string;
  className?: string;
  "data-testid"?: string;
  /** Testid for the inline reason. Defaults to the pipeline's `row-reason`. */
  reasonTestId?: string;
}

export function RecordRow({
  identity,
  label,
  status,
  reason,
  time,
  accent,
  expanded,
  onToggle,
  children,
  rowKey,
  className,
  "data-testid": testId,
  reasonTestId = "row-reason",
}: RecordRowProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div data-testid={testId} data-row-key={rowKey} className={className}>
      <button
        type="button"
        onClick={onToggle}
        className={[
          "w-full flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-card/30 hover:bg-accent/60 transition-colors text-left",
          accent ?? "",
          expanded ? "rounded-b-none bg-accent/60" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-expanded={expanded}
      >
        <Badge variant="outline" className="font-mono text-xs shrink-0">
          {identity}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
        {status}
        {reason && !expanded && (
          // The reason rides beside the badge from `sm` up (it used to appear
          // only at `lg`, which hid the answer to "why?" on most laptops).
          // Below that, and whenever it truncates, the badge's title carries
          // the full text.
          <span
            className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[22ch] lg:max-w-[40ch]"
            title={reason}
            data-testid={reasonTestId}
          >
            {reason}
          </span>
        )}
        {time}
        <Chevron className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {expanded && children}
    </div>
  );
}
