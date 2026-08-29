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
 * union or own a palette. R4's accent is NOT a slot, though — the row takes an
 * `attention` and derives the border from it (see that prop's doc for why it
 * is one prop and not two), which keeps the row body neutral and is what keeps
 * 40 rows readable when 6 are red.
 *
 * The whole line is ONE `<button>`: R5's "clicking the row expands it" has to
 * be reachable by keyboard, and a div with an onClick is not.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Attention } from "./attention";
import { rowAccentClass } from "./statusRow";

/**
 * The key the enclosing `<RecordList>` keyed this row on, or `null` when the
 * row is rendered outside one.
 *
 * `<RecordList>` provides it; `<RecordRow>` reads it. Nothing else should.
 */
export const RecordRowKeyContext = createContext<string | null>(null);

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
  /**
   * Who must act on this row — R4's left-edge accent AND its machine-readable
   * twin, from one prop.
   *
   * **It replaced a separate `accent: string`, and that is the point.** The
   * colour is the operator's channel; `data-attention` is the same fact in a
   * channel a stylesheet rule, a spec selector or a `/visual-audit` assertion
   * can address. Two props meant every caller wrote the fact twice —
   * `accent={rowAccentClass(status)} attention={status.attention}` — and both
   * ways of getting that wrong are SILENT: pass the accent and forget the
   * attribute and Phase 4's `[data-attention="author"]` rule selects nothing
   * and reports PASS; derive them from different statuses and the rule passes
   * while the DOM misreports which rows need action. Deriving the class here
   * makes both unrepresentable, which is what `rowAccentProps` does for the
   * plain elements that are not `<RecordRow>`s.
   *
   * Optional, and ABSENT rather than `"none"` when the caller omits it: "this
   * row is calm" and "this surface does not classify rows" are different
   * claims, and an audit that cannot tell them apart reads the second as the
   * first.
   */
  attention?: Attention;
  expanded: boolean;
  onToggle: () => void;
  /**
   * The detail panel, rendered BELOW the row and only while expanded. Normally
   * a `<RecordDetail>`, which shares this row's border (`border-t-0
   * rounded-b-md`) so the two read as one object.
   */
  children?: ReactNode;
  /**
   * Written to `data-row-key` — the row's stable identity for e2e/specs.
   *
   * **Inside a `<RecordList>` this is IGNORED, and that is the point.** The
   * list already computed the row's identity, via `itemKey`, and keys both the
   * React reconciliation and the one-open-at-a-time expansion on it. A row
   * deriving a second identity from the same record cannot be more right than
   * the list, and can be — was — wrong: on four surfaces the two expressions
   * disagreed, so `data-row-key` named something no expansion state ever used.
   * `/trees` disagreed totally (`device_id:repo` against `repo:primary_path`),
   * `/alerts` in exactly the collision-prone fallback the index suffix exists
   * for, `/releases` and `/agents` in one leg of their `??` chains each.
   *
   * So the list wins where there is a list, and this prop is the source only
   * where there is not — `PlanLibraryList`'s hand-rolled `.map` (its expansion
   * has two anchors, so it deliberately owns no list) and the agent-detail log
   * feed. Keep supplying it: it is what those surfaces, and a standalone
   * render in a unit test, have.
   */
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
  attention,
  expanded,
  onToggle,
  children,
  rowKey,
  className,
  "data-testid": testId,
  reasonTestId = "row-reason",
}: RecordRowProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // The list's key wins over the prop — see `rowKey`'s doc. `null` (the
  // context default) means there is no enclosing list, so the prop is the only
  // source; `??` rather than `||` so a list could legitimately key a row on
  // the empty string.
  const listKey = useContext(RecordRowKeyContext);
  const resolvedRowKey = listKey ?? rowKey;
  return (
    <div data-testid={testId} data-row-key={resolvedRowKey} className={className}>
      <button
        type="button"
        onClick={onToggle}
        // `data-console-row` marks THE row line — the element that owns the
        // padding, the font size and the accent — so a style rule keyed on
        // `[data-console-row]` selects the thing §5's density budget is about
        // rather than the wrapper around it. `text-sm` is added here to make
        // the row's own font size explicit rather than inherited: it is what
        // the label already renders at, and every other child sets its own
        // size, so this is visually inert and turns an inherited value into a
        // stated one.
        data-console-row=""
        data-attention={attention}
        className={[
          "w-full flex items-center gap-3 px-3 py-2 text-sm border border-border rounded-md bg-card/30 hover:bg-accent/60 transition-colors text-left",
          attention ? rowAccentClass({ attention }) : "",
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
