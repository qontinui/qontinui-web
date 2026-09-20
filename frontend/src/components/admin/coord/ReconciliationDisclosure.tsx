"use client";

/**
 * What this read of `/plan-library/reconciliation` did and did not measure.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 2, and
 * its general rule, which is the reason this block exists rather than a
 * footnote: **render the population state before any flag derived from the
 * population.**
 *
 * The ORDER of the lines is the contract, and it is computed — not authored
 * here — by `planReconciliationStatus.ts` `deriveDisclosure`, which also decides
 * whether the document-completeness claim may be published at all. On a read
 * where coord's work-unit population arm failed, that claim is vacuously true
 * (Phase 0, Finding 2: the degraded read is the MORE optimistic one) and the
 * deriver suppresses it. This component renders what it is handed, in the
 * order it is handed, and never re-decides any of it.
 *
 * It is deliberately NOT inside the `<CollapsiblePanel>` the work-unit page
 * uses for its window caveats (R7). R7 collapses *secondary* material; a line
 * saying "axis A is UNKNOWN for every row on this page" is the primary reading
 * of the page it sits on, and one click is exactly how the original defect got
 * through.
 */

import { Info, TriangleAlert } from "lucide-react";
import type {
  DisclosureLevel,
  DisclosureLine,
} from "./planReconciliationStatus";

const LINE_CLASS: Record<DisclosureLevel, string> = {
  critical: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  caveat: "border-border bg-card text-muted-foreground",
  note: "border-border bg-card text-muted-foreground",
};

export function ReconciliationDisclosure({
  lines,
}: {
  lines: readonly DisclosureLine[];
}) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="coord-plans-disclosure">
      {lines.map((line) => (
        <div
          key={line.key}
          className={`rounded border px-2.5 py-1.5 text-xs ${LINE_CLASS[line.level]}`}
          data-testid={`coord-plans-disclosure-${line.key}`}
          data-level={line.level}
        >
          <div className="flex items-start gap-1.5">
            {line.level === "critical" ? (
              <TriangleAlert
                className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400"
                aria-hidden="true"
              />
            ) : (
              <Info
                className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70"
                aria-hidden="true"
              />
            )}
            <span>{line.text}</span>
          </div>
          {/* VERBATIM. `work_unit_population_reason` and
              `facets.corpus_incomplete_reasons` are the fields that still say
              something true when the boolean flags do not, so they are quoted
              rather than summarised. */}
          {line.items && line.items.length > 0 && (
            <ul
              className="list-disc pl-7 mt-1 space-y-0.5 font-mono text-[11px]"
              data-testid={`coord-plans-disclosure-${line.key}-items`}
            >
              {line.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
