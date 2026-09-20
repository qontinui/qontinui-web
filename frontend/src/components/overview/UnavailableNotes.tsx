"use client";

/**
 * The figures a page could NOT produce, and why.
 *
 * "Unknown is not zero" (plan
 * `2026-09-19-project-overview-for-business-leaders`, "Design decisions" 5)
 * only holds if the reasons are visible somewhere. The rollup returns them;
 * this renders them, so a blank cell upstairs always has a sentence
 * downstairs explaining it rather than reading as nothing to report.
 */

import type { RollupUnavailable } from "@/app/(app)/overview/_lib/estimate-api";

export function UnavailableNotes({
  items,
  uiBridgeId,
  heading = "What isn’t available here",
}: {
  items: RollupUnavailable[];
  uiBridgeId: string;
  heading?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby={`${uiBridgeId}-heading`}
      className="border-l-2 border-border pl-4"
      data-ui-bridge-id={uiBridgeId}
    >
      <h3
        id={`${uiBridgeId}-heading`}
        className="text-sm font-medium text-foreground"
      >
        {heading}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li
            key={`${item.figure}:${item.reason}`}
            className="text-sm leading-relaxed text-muted-foreground"
            // Keyed on figure AND reason: one reason can legitimately
            // describe two figures (`mixed_currencies` applies to the
            // non-labour items and to the grand total), and two elements
            // sharing a UI-Bridge id make both unaddressable.
            data-ui-bridge-id={`${uiBridgeId}.${item.figure}.${item.reason}`}
          >
            {item.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The em dash a table cell shows where a figure does not exist. */
export function NotAvailable({ label = "not available" }: { label?: string }) {
  return (
    <span className="text-muted-foreground" title={label}>
      <span aria-hidden>&mdash;</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
