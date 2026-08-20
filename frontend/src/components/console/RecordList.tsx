"use client";

/**
 * RecordList — the list of `<RecordRow>`s, its loading shape, and its empty
 * state.
 *
 * **Enforces R2 and R5, plus the honest empty state.**
 * See `frontend/docs/console-ui-style-guide.md` §2 R2/R5 and §3.2.
 *
 * Generalised out of `MergePipeline.tsx`'s `expandedKey` state + skeleton +
 * empty-state block by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1.
 *
 * The three states are ONE decision, which is why they are one component:
 *
 * - **not loaded** → skeleton rows at row height. Never an empty list: an
 *   empty list while a fetch is in flight is a claim that nothing exists, and
 *   we do not know that yet. This is `silent-empty-is-unknown` applied to a
 *   list.
 * - **loaded and empty** → the caller's `empty` node. The caller supplies it
 *   because an honest empty state names WHICH question came back empty
 *   ("nothing merged in the last 48 hours" ≠ "no PRs match this filter" ≠
 *   "no open PRs"), and a primitive cannot know that.
 * - **loaded with rows** → the rows, ONE OPEN AT A TIME (R5).
 *
 * Expansion state is internal by default and controllable by the caller. A
 * surface whose list unmounts (a tab that swaps the list for something else)
 * hoists the state so a reopened tab reopens the row the operator left open.
 */

import { Fragment, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export interface RecordListRenderContext {
  expanded: boolean;
  onToggle: () => void;
}

export interface RecordListBaseProps<T> {
  items: T[];
  /** Stable identity per item — the expansion key and the React key. */
  itemKey: (item: T) => string;
  /** Render one row. Normally a `<RecordRow>` given `expanded` / `onToggle`. */
  renderRow: (item: T, ctx: RecordListRenderContext) => ReactNode;
  /** False while the data has not arrived — renders skeletons, not "empty". */
  loaded?: boolean;
  /** Skeleton row count while unloaded. */
  skeletonRows?: number;
  /** What to say when the list is loaded and genuinely empty. */
  empty?: ReactNode;
  className?: string;
}

/**
 * Expansion state: internal, or fully hoisted. A UNION rather than two
 * optional props, so passing only one of the pair is a TYPE ERROR instead of
 * a silent fallback to internal state that the caller then wonders about.
 * 29 routes are about to adopt this primitive; "why is my expandedKey
 * ignored?" is not a question any of them should have to debug.
 */
export type RecordListExpansion =
  | { expandedKey?: undefined; onExpandedKeyChange?: undefined }
  | {
      /** The open row's key, or null. Supply WITH `onExpandedKeyChange`. */
      expandedKey: string | null;
      onExpandedKeyChange: (key: string | null) => void;
    };

export type RecordListProps<T> = RecordListBaseProps<T> & RecordListExpansion;

export function RecordList<T>({
  items,
  itemKey,
  renderRow,
  loaded = true,
  skeletonRows = 3,
  empty,
  expandedKey,
  onExpandedKeyChange,
  className,
}: RecordListProps<T>) {
  const [ownKey, setOwnKey] = useState<string | null>(null);
  // The union above guarantees these arrive together or not at all.
  const controlled = onExpandedKeyChange != null;
  const openKey = controlled ? (expandedKey ?? null) : ownKey;
  const setOpenKey = (next: string | null) => {
    if (onExpandedKeyChange != null) onExpandedKeyChange(next);
    else setOwnKey(next);
  };

  if (!loaded) {
    return (
      <div className="space-y-2">
        {Array.from({ length: skeletonRows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) return <>{empty}</>;

  return (
    <div className={className ?? "space-y-1.5"}>
      {items.map((item) => {
        const key = itemKey(item);
        return (
          // A Fragment, not a wrapper element: `space-y-*` is a `> * + *`
          // margin rule, so an extra (even `display:contents`) wrapper would
          // silently swallow the gap between rows.
          <Fragment key={key}>
            {renderRow(item, {
              expanded: openKey === key,
              // One open at a time: opening a row closes the previous one.
              onToggle: () => setOpenKey(openKey === key ? null : key),
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
