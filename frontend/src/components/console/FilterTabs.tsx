"use client";

/**
 * FilterTabs — the tab strip with live counts, plus the filter input.
 *
 * **Enforces R6 — "Filter tabs carry live counts."**
 * See `frontend/docs/console-ui-style-guide.md` §2 R6 and §3.2.
 *
 * Generalised out of `MergePipeline.tsx`'s filter-tab block by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1.
 *
 * **The load-bearing clause is the dash.** A count that has NOT BEEN FETCHED
 * renders `–`, never `0`:
 *
 * > "before that a count would be a lie" — `MergePipeline.tsx`, on the merged
 * > tab, whose rows are only fetched while that tab is open.
 *
 * A `0` says *we looked and there is nothing*. A tab whose data has not been
 * requested has not looked, and painting that as `0` is the
 * `silent-empty-is-unknown` mistake with a number attached — an operator reads
 * "nothing landed today" off a count that means "nobody asked". The rule lives
 * HERE, in the primitive, rather than in each page's JSX, precisely because it
 * is the clause a page author will not think to reproduce:
 *
 *   `count == null` → `–`   (unknown: not fetched, or the source could not answer)
 *   `count === 0`   → `0`   (known: we looked, there is nothing)
 *
 * so a caller expresses "unknown" by passing `null`/`undefined`, which is what
 * an unfetched value already is.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface FilterTab<Id extends string> {
  id: Id;
  label: ReactNode;
  /**
   * The tab's live count. `null`/`undefined` means NOT FETCHED / UNKNOWN and
   * renders `–`. Pass `0` only when you actually looked.
   */
  count?: number | null;
  /**
   * Render the count in the attention hue. Reserve it for a count of rows that
   * genuinely need a human (R3) — a red number nobody must act on is the same
   * bug as a red badge nobody must act on.
   */
  attention?: boolean;
  /** Overrides `${testIdPrefix}-${id}`. */
  testId?: string;
}

export interface FilterTabsProps<Id extends string> {
  tabs: ReadonlyArray<FilterTab<Id>>;
  active: Id;
  onChange: (id: Id) => void;
  /** `${testIdPrefix}-${tab.id}` for each tab, when a tab has no own testId. */
  testIdPrefix?: string;
  /** Right-aligned filter input. Rendered only when `onQueryChange` is given. */
  query?: string;
  onQueryChange?: (query: string) => void;
  queryPlaceholder?: string;
  queryTestId?: string;
  className?: string;
}

/** R6's unfetched-count rule, in one place. */
function renderCount(count: number | null | undefined): ReactNode {
  return count == null ? "–" : count;
}

export function FilterTabs<Id extends string>({
  tabs,
  active,
  onChange,
  testIdPrefix,
  query,
  onQueryChange,
  queryPlaceholder,
  queryTestId,
  className,
}: FilterTabsProps<Id>) {
  return (
    <div
      className={className ?? "flex items-center gap-1.5 flex-wrap"}
    >
      {tabs.map((tab) => (
        <Button
          key={tab.id}
          size="sm"
          variant={active === tab.id ? "secondary" : "ghost"}
          onClick={() => onChange(tab.id)}
          data-testid={
            tab.testId ??
            (testIdPrefix ? `${testIdPrefix}-${tab.id}` : undefined)
          }
        >
          {tab.label}
          <span
            className={`font-mono text-[11px] ${
              tab.attention ? "text-red-300" : "text-muted-foreground"
            }`}
          >
            {renderCount(tab.count)}
          </span>
        </Button>
      ))}
      {onQueryChange && (
        <input
          value={query ?? ""}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={queryPlaceholder}
          className="ml-auto w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid={queryTestId}
        />
      )}
    </div>
  );
}
