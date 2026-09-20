"use client";

/**
 * What a read did and did not measure, rendered.
 *
 * The rendering half of `disclosureLines.ts`, extracted from
 * `ReconciliationDisclosure` by Phase 4c of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store` so
 * `/admin/coord/plan-candidates` composes it rather than growing a second
 * spelling of the same block.
 *
 * It renders what it is handed, in the ORDER it is handed, and re-decides
 * nothing: which lines exist, in what order, and whether a flag may be
 * published at all are decisions each surface's own pure module makes.
 *
 * It is deliberately NOT inside a `<CollapsiblePanel>` (R7). R7 collapses
 * *secondary* material; a line saying "axis A is UNKNOWN for every row" or
 * "this total counts 2% of the corpus" is the primary reading of the page it
 * sits on, and one click is exactly how the original defect got through.
 */

import { Info, TriangleAlert } from "lucide-react";
import type { DisclosureLevel, DisclosureLine } from "./disclosureLines";

const LINE_CLASS: Record<DisclosureLevel, string> = {
  critical: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  caveat: "border-border bg-card text-muted-foreground",
  note: "border-border bg-card text-muted-foreground",
};

export function DisclosureLines({
  lines,
  testIdPrefix,
}: {
  lines: readonly DisclosureLine[];
  /** `<prefix>` on the container, `<prefix>-<key>` on each line. */
  testIdPrefix: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid={testIdPrefix}>
      {lines.map((line) => (
        <div
          key={line.key}
          className={`rounded border px-2.5 py-1.5 text-xs ${LINE_CLASS[line.level]}`}
          data-testid={`${testIdPrefix}-${line.key}`}
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
          {/* VERBATIM. `work_unit_population_reason`,
              `facets.corpus_incomplete_reasons` and
              `corpus_health_unavailable_reason` are the fields that still say
              something true when the boolean flags do not, so they are quoted
              rather than summarised. */}
          {line.items && line.items.length > 0 && (
            <ul
              className="list-disc pl-7 mt-1 space-y-0.5 font-mono text-[11px]"
              data-testid={`${testIdPrefix}-${line.key}-items`}
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
