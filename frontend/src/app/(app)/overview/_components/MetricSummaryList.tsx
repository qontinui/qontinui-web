"use client";

/**
 * The Summary's "How success is measured", as a compact list (plan
 * `2026-10-06-overview-objectives-view` D1): each measure's title, its latest
 * checkpoint tally when it has one, and a link to its card on Objectives,
 * where the prose and its editor now live. The reorder controls stay here.
 *
 * Fed by the objectives read beside the Summary's own document read. When
 * that read fails the list still names every written measure from the
 * document read, says results and status can't be read, and filters nothing
 * (a void document cannot be told apart without the read) — each row is
 * "status unknown" instead.
 */

import Link from "next/link";
import { useState } from "react";
import { LoadFailure } from "@/components/overview/LoadFailure";
import { ChangeLogPanel } from "@/components/overview/editing/ChangeLogPanel";
import type { IntentEntry } from "../_lib/intent";
import {
  metricAnchor,
  hiddenCopy,
  summaryMetricRows,
  type SummaryMetrics,
} from "../_lib/objectives";

const linkButton =
  "inline-flex min-h-9 items-center rounded-md px-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground disabled:no-underline";

export function MetricSummaryList({
  entries,
  status,
  canEdit,
  move,
}: {
  /** The written success_metric documents, in reading order. */
  entries: IntentEntry[];
  status: SummaryMetrics;
  canEdit: boolean;
  move: (
    section: readonly IntentEntry[],
    from: number,
    to: number
  ) => Promise<string | null>;
}) {
  const rows = summaryMetricRows(entries, status);
  const shown = rows.map((r) => r.entry);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const reorder = async (from: number, to: number) => {
    setMoving(true);
    setMoveError(null);
    // Move within the FULL written list, so a hidden void document keeps a
    // position of its own rather than colliding with a renumbered row.
    const fullFrom = entries.indexOf(shown[from]!);
    const fullTo = entries.indexOf(shown[to]!);
    setMoveError(await move(entries, fullFrom, fullTo));
    setMoving(false);
  };

  return (
    <div
      className="mt-3 space-y-3"
      data-ui-bridge-id="overview.summary.success-metric.list"
    >
      {status.state === "failed" && (
        <div
          role="status"
          className="border-l-2 border-warning pl-4"
          data-ui-bridge-id="overview.summary.success-metric.status-unreadable"
        >
          <p className="text-[15px] leading-relaxed text-foreground">
            Results and status can&rsquo;t be read.
          </p>
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="inline-block cursor-pointer select-none rounded-sm py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Technical details
            </summary>
            <p className="mt-1 break-all font-mono">{status.message}</p>
          </details>
        </div>
      )}
      {status.state === "ready" && status.voidHidden > 0 && (
        <p
          className="text-sm text-muted-foreground"
          data-ui-bridge-id="overview.summary.success-metric.void-hidden"
        >
          {hiddenCopy({
            void_hidden: status.voidHidden,
            skeletons_hidden: 0,
          }).join(" ")}
        </p>
      )}
      <ul className="divide-y divide-border">
        {rows.map(({ entry, status: rowStatus }, index) => {
          const docId = `success-metric-${entry.name}`;
          return (
            <li
              key={entry.id}
              className="py-3"
              data-ui-bridge-id={`overview.summary.${docId}`}
            >
              <h3
                id={`${docId}--title`}
                tabIndex={-1}
                className="font-[family-name:var(--font-overview-serif)] text-lg leading-snug text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-ui-bridge-id={`overview.summary.${docId}.title`}
              >
                {entry.title}
              </h3>
              {entry.state === "unreadable" ? (
                <LoadFailure
                  what="this measure"
                  message={entry.error ?? ""}
                  uiBridgeId={`overview.summary.${docId}.error`}
                  announce={false}
                />
              ) : (
                <p
                  className="text-sm text-muted-foreground"
                  data-ui-bridge-id={`overview.summary.${docId}.status`}
                >
                  {rowStatus && rowStatus.unknown && (
                    <span aria-hidden>? </span>
                  )}
                  {rowStatus?.line ?? ""}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-x-3">
                <Link
                  href={`/overview/objectives#${metricAnchor(entry.name)}`}
                  className={linkButton}
                  data-ui-bridge-id={`overview.summary.${docId}.open`}
                >
                  See it on Objectives
                </Link>
                <ChangeLogPanel
                  resource="intent_documents"
                  recordId={entry.id}
                  updatedBy={entry.updatedBy}
                  updatedAt={entry.updatedAt}
                  uiBridgeId={`overview.summary.${docId}.history`}
                />
                {canEdit && shown.length > 1 && (
                  <span
                    className="flex gap-1"
                    role="group"
                    aria-label={`Order of ${entry.title}`}
                  >
                    <button
                      type="button"
                      className={linkButton}
                      disabled={moving || index === 0}
                      onClick={() => void reorder(index, index - 1)}
                      aria-label={`Move ${entry.title} up`}
                      data-ui-bridge-id={`overview.summary.${docId}.move-up`}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className={linkButton}
                      disabled={moving || index === shown.length - 1}
                      onClick={() => void reorder(index, index + 1)}
                      aria-label={`Move ${entry.title} down`}
                      data-ui-bridge-id={`overview.summary.${docId}.move-down`}
                    >
                      Move down
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {moveError && (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-ui-bridge-id="overview.summary.success-metric.move-error"
        >
          {moveError}
        </p>
      )}
    </div>
  );
}
