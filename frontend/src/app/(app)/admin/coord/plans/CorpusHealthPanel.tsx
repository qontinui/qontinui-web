"use client";

/**
 * Corpus health — the scan-source and coverage panels from the retired
 * `/admin/coord/plan-library` page, collapsed into `/admin/coord/plans`.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 1
 * step 4 and Design decision 4b. Collapsed by default with a one-line summary
 * (`corpusHealth.ts`) that keeps each finding visible while closed.
 *
 * The two panels are IMPORTED from `plan-library/_components` and not moved:
 * `PlanCoveragePanel.tsx` has an open pull request against it, and each panel
 * owns its own read and Refresh. They mount only while this panel is open
 * (`CollapsiblePanel` unmounts its children), so the costly coverage
 * computation is paid on demand rather than on every page load.
 *
 * Capture health is NOT repeated here: `/plans` already renders the capture
 * census (`components/admin/coord/CaptureHealthPanel`) over the same
 * `/plan-library/capture-health` route, and two panels over one read would
 * drift apart on screen.
 *
 * The fork marker links to `/admin/coord/plan-forks` from `headerActions`,
 * which `CollapsiblePanel` renders OUTSIDE its toggle button — a link inside
 * the trigger would be interactive content inside a `<button>`.
 */

import Link from "next/link";
import { GitFork, HeartPulse } from "lucide-react";
import { CollapsiblePanel } from "@/components/console";
import { useScanRoots } from "../plan-library/_hooks/usePlanLibrary";
import { ScanSourcesPanel } from "../plan-library/_components/ScanSourcesPanel";
import { PlanCoveragePanel } from "../plan-library/_components/PlanCoveragePanel";
import { summarizeScanSources } from "./corpusHealth";

export function CorpusHealthPanel({
  pageForks,
  pageRowCount,
}: {
  /** Divergent stems on this page, or `null` when no page has been read. */
  pageForks: number | null;
  pageRowCount: number | null;
}) {
  const scan = useScanRoots();
  const scanSummary = summarizeScanSources(scan.data, scan.error, scan.loading);

  return (
    <CollapsiblePanel
      title="Corpus health"
      titleAs="h3"
      icon={
        <HeartPulse className="h-4 w-4 text-muted-foreground" aria-hidden />
      }
      defaultOpen={false}
      storageKey="coord-plans-corpus-health-open"
      data-testid="coord-plans-corpus-health"
      summary={
        <span
          className="text-xs normal-case tracking-normal text-muted-foreground"
          data-testid="coord-plans-corpus-health-summary"
        >
          <span
            className={scanSummary.unknown ? "text-amber-200" : undefined}
            data-testid="coord-plans-corpus-health-scan"
          >
            {scanSummary.text}
          </span>
          {" · "}
          <span data-testid="coord-plans-corpus-health-coverage">
            coverage computed on open
          </span>
        </span>
      }
      headerActions={
        <Link
          href="/admin/coord/plan-forks"
          className="inline-flex items-center gap-1 underline"
          data-testid="coord-plans-forks-link"
          title="Every stem whose document copies disagree, across the whole corpus."
        >
          <GitFork className="h-3 w-3" aria-hidden />
          {pageForks === null
            ? "plan forks"
            : `${pageForks} forked stem${pageForks === 1 ? "" : "s"} on this page${
                pageRowCount !== null ? ` of ${pageRowCount}` : ""
              } — all forks`}
        </Link>
      }
    >
      <div className="space-y-3">
        <ScanSourcesPanel />
        <PlanCoveragePanel />
      </div>
    </CollapsiblePanel>
  );
}
