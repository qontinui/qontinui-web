"use client";

/**
 * FilterChips — the MULTI-select sibling of `FilterTabs`.
 *
 * **Enforces R6 — "Filter tabs carry live counts."**
 * See `frontend/docs/console-ui-style-guide.md` §2 R6 and §3.2.
 *
 * Added by the qontinui-web#1049 follow-up, under §6.4 ("a new console page
 * adds no new visual vocabulary — it composes the primitives, or it extends
 * the guide in the same PR"). The page that needed it is `/admin/coord/alerts`.
 *
 * ## Why a second component instead of a prop on `FilterTabs`
 *
 * `FilterTabs` is `{ active: Id, onChange: (id) => void }` — a control that
 * names exactly one selection. Widening it to `Id | Id[]` would make every
 * existing caller's `active` a union to narrow, and would give one component
 * two different empty states ("the `all` tab is active" vs "nothing is
 * selected"), which is precisely the ambiguity the split avoids. They render
 * the same chrome and read as one family; they answer different questions.
 *
 * ## Empty selection means NO FILTER
 *
 * `selected: []` is the unfiltered state, and it is NOT a synthetic `"any"`
 * option. A console filter's values are usually a server vocabulary — coord's
 * `severity`, its `kind` list — and minting an `"any"` member invents a value
 * the API has never heard of, which a caller then has to remember to strip
 * before it reaches a query string. The `all` chip is a CLEAR action instead,
 * and it renders active exactly when nothing is selected.
 *
 * This matters most where the API is REPEATABLE. `/operations/alerts` takes
 * `?kind=a&kind=b`, and its proxy deliberately drops blank values because an
 * explicitly-empty `?kind=` asks coord for the rows whose kind is the empty
 * string — "no filter" inverted into "match nothing". A control whose empty
 * state is a real value is one refactor away from sending that blank.
 *
 * ## Counts are a GROUP decision, and `–`-not-`0` still holds inside one
 *
 * A multi-select filter often cannot know its per-option counts without one
 * request per option — `/admin/coord/alerts` would pay a `limit=1` read per
 * kind, every poll — so unlike `FilterTabs` this strip may carry no counts at
 * all. That is a property of the STRIP, not of each chip: if **any** option
 * supplies a `count`, every chip renders the count slot, and R6 applies inside
 * it unchanged — `count == null` renders `–` (nobody looked), `count === 0`
 * renders `0` (we looked, nothing matched).
 *
 * The group-level test is what keeps this consistent with `FilterTabs`, where
 * an absent count and an explicit `null` are the SAME claim. Reading a bare
 * `count === undefined` as "no count wanted" per-chip would have made the two
 * components disagree about the same value, which is exactly the drift the
 * primitive catalogue exists to prevent.
 *
 * ## `maxVisible`, and why a server vocabulary needs it
 *
 * `FilterTabs`' vocabulary is authored — four tabs, and the author sees them.
 * This one's usually is not: it is whatever the server currently has. Coord's
 * alert corpus was **43 distinct live kinds on 2026-08-24** (measured, not
 * estimated — qontinui-web#1063), against the ~10 the alerts page was written
 * for. Forty-three chips is four or five wrapped rows above the records, which
 * is §5's density budget spent on a control.
 *
 * So a capped strip discloses `+N more`, every selected option is exempt from
 * the cap, and the order is the options' own — a chip that jumped position on
 * click would trade one usability problem for another. Omit `maxVisible` for a
 * vocabulary you author and can count.
 */

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface FilterChipOption<V extends string> {
  value: V;
  label: ReactNode;
  /**
   * Rows matching this option. Counts are a GROUP decision (see the module
   * doc): a strip where NO option carries one renders no count slot at all,
   * and inside a strip where any does, `null` means NOT FETCHED / UNKNOWN and
   * renders `–`. Pass `0` only when you actually looked.
   */
  count?: number | null;
  /** Overrides `${testIdPrefix}-${value}`. */
  testId?: string;
  title?: string;
}

export interface FilterChipsProps<V extends string> {
  /** Rendered before the chips — "severity:", "kind:". */
  label: string;
  options: ReadonlyArray<FilterChipOption<V>>;
  /** The current selection. EMPTY means no filter — see the module doc. */
  selected: ReadonlyArray<V>;
  /** Called with the toggled value; the caller owns add/remove. */
  onToggle: (value: V) => void;
  /**
   * Called by the `all` chip. Clears to the unfiltered state. Never called
   * while the selection is ALREADY empty — that chip is disabled, so a caller
   * may write the obvious `() => setSelected([])` without its fresh array
   * invalidating a selection-keyed callback on a click that changed nothing.
   */
  onClear: () => void;
  /**
   * The `all` chip's label. Override to say something the plain word cannot —
   * `/admin/coord/alerts` renders "all (list partial)" when coord served no
   * kind vocabulary and the options are only the kinds already loaded.
   */
  allLabel?: ReactNode;
  /**
   * Cap the chips rendered before a `+N more` disclosure. Omit for a small,
   * fixed vocabulary (three severities); supply it whenever the options come
   * from a SERVER list, which has no ceiling you control.
   *
   * A SELECTED option is never hidden by the cap — the visible set is the
   * first `maxVisible` options unioned with everything selected, in the
   * options' own order. A filter that hides what it is filtering on is the
   * same defect as one whose chip disappears when its last row resolves.
   */
  maxVisible?: number;
  /** `${testIdPrefix}-${value}` per chip, plus `${testIdPrefix}-all`. */
  testIdPrefix?: string;
  /** Applied to the group, e.g. to explain a partial option list. */
  title?: string;
  className?: string;
}

/** R6's unfetched-count rule, same clause as `FilterTabs`. */
function renderCount(count: number | null | undefined): ReactNode {
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      {count == null ? "–" : count}
    </span>
  );
}

export function FilterChips<V extends string>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  allLabel = "all",
  maxVisible,
  testIdPrefix,
  title,
  className,
}: FilterChipsProps<V>) {
  const [expanded, setExpanded] = useState(false);
  const none = selected.length === 0;
  // Counts are a group decision, so that an absent `count` and an explicit
  // `null` keep meaning the same thing INSIDE a counted strip — the reading
  // `FilterTabs` already has. An uncounted strip renders no slot at all.
  const counted = options.some((o) => o.count !== undefined);

  // The cap, with every selected option exempt from it. `head` is the first
  // `maxVisible`; the union keeps the options' own order rather than hoisting
  // the selected ones, so a chip does not jump position the moment you click
  // it.
  const capped =
    maxVisible !== undefined && !expanded && options.length > maxVisible;
  const visible = capped
    ? options.filter((o, i) => i < maxVisible || selected.includes(o.value))
    : options;
  const hidden = options.length - visible.length;

  return (
    <div
      className={className ?? "flex flex-wrap items-center gap-1"}
      // The selection as an attribute, so a test — and an operator reading the
      // DOM — sees what is filtered without reconstructing it from which
      // buttons happen to be styled active.
      data-selected={selected.join(",")}
      data-testid={testIdPrefix}
      role="group"
      aria-label={`${label} filter`}
      title={title}
    >
      <span className="text-xs text-muted-foreground normal-case tracking-normal">
        {label}:
      </span>
      <Button
        type="button"
        size="sm"
        variant={none ? "secondary" : "ghost"}
        onClick={onClear}
        aria-pressed={none}
        // DISABLED while it is already the state, for two reasons that are the
        // same reason: a control that announces itself pressed and then does
        // nothing is a lie to a screen reader, and `onClear` is a caller's
        // `setState([])` — a FRESH array every call, so React's `Object.is`
        // bailout never fires and a no-op click still invalidates every
        // selection-keyed `useCallback` downstream. On a paging surface that
        // is not cosmetic: it re-runs the page-1 fetch and discards whatever
        // the operator had paged into, for a click that changed no filter.
        disabled={none}
        data-testid={testIdPrefix ? `${testIdPrefix}-all` : undefined}
      >
        {allLabel}
      </Button>
      {visible.map((o) => {
        const active = selected.includes(o.value);
        return (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={active ? "secondary" : "ghost"}
            onClick={() => onToggle(o.value)}
            aria-pressed={active}
            title={o.title}
            data-testid={
              o.testId ??
              (testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined)
            }
          >
            {o.label}
            {counted && renderCount(o.count)}
          </Button>
        );
      })}
      {(hidden > 0 || expanded) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="text-muted-foreground"
          data-testid={testIdPrefix ? `${testIdPrefix}-more` : undefined}
        >
          {expanded ? "show fewer" : `+${hidden} more`}
        </Button>
      )}
    </div>
  );
}
