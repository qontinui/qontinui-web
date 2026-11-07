"use client";

/**
 * A checkpoint report, rendered INLINE from the objectives response (plan
 * `2026-10-06-overview-objectives-view` Phase 2) — never a link to the coord
 * console, an operator surface a business reader may not be able to open.
 * Collapsed by default; anything on the card that says "open the report"
 * opens this panel in place.
 */

import { MarkdownView } from "@/components/overview/MarkdownView";
import { formatRelativeTime } from "@/lib/time-utils";
import { shortDay } from "../../_lib/objectives";
import type { ReportRead } from "../../_lib/objectives-api";
import { DISCLOSURE, MUTED } from "./ui";

/** The DOM id of a report's panel. */
export function reportPanelId(metricName: string, findingId: string): string {
  return `report-${metricName}-${findingId}`;
}

/** Open a report's panel in place and move focus to it. */
export function openReport(metricName: string, findingId: string): void {
  const el = document.getElementById(reportPanelId(metricName, findingId));
  if (!(el instanceof HTMLDetailsElement)) return;
  el.open = true;
  el.scrollIntoView({ block: "nearest" });
  el.querySelector("summary")?.focus();
}

const SHAPE_WORDS: Record<ReportRead["shape"], string> = {
  structured: "with a readable result",
  prose_only: "in prose only",
  unreadable_block: "with a result that could not be read",
};

export function ReportPanel({
  metricName,
  report,
  label = "Open the report",
  uiBridgeId,
}: {
  metricName: string;
  report: ReportRead;
  label?: string;
  uiBridgeId: string;
}) {
  const posted = shortDay(report.created_at);
  return (
    <details
      id={reportPanelId(metricName, report.finding_id)}
      className="mt-2"
      data-ui-bridge-id={uiBridgeId}
    >
      <summary className={DISCLOSURE}>{label}</summary>
      <div className="mt-2 rounded-md border border-border p-4">
        <p className="text-[15px] font-medium leading-snug text-foreground">
          {report.title ?? "Checkpoint report"}
        </p>
        <p className={`mt-1 ${MUTED}`}>
          {posted ? `Posted ${posted}` : "Posting date unknown"}
          {report.created_at
            ? ` (${formatRelativeTime(report.created_at)})`
            : ""}
          , {SHAPE_WORDS[report.shape]}
          {report.recorded ? "." : "; not yet recorded on the document."}
        </p>
        {report.checkpoint_mismatch && (
          <p
            className={`mt-1 ${MUTED}`}
            data-ui-bridge-id={`${uiBridgeId}.mismatch`}
          >
            {report.checkpoint_mismatch}
          </p>
        )}
        {report.block_error && (
          <p
            className={`mt-1 ${MUTED}`}
            data-ui-bridge-id={`${uiBridgeId}.block-error`}
          >
            Why the result could not be read: {report.block_error}
          </p>
        )}
        <div className="mt-3">
          {report.body ? (
            <MarkdownView headingOffset={3}>{report.body}</MarkdownView>
          ) : (
            <p className={MUTED}>
              The report&rsquo;s text was not served with it.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}
