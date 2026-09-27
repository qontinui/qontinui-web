"use client";

/**
 * A delivery-plan document and the project estimate (Phase 2c of plan
 * `2026-09-20-overview-authoring-layer`): says when this document is the
 * estimate's recorded source, and offers "Use as the project estimate" to
 * whoever may edit the estimate. That opens the estimate editor with this
 * document named, and its mermaid gantt chart ready to import.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCanEdit } from "@/components/overview/editing/permissions";
import {
  fetchEstimates,
  pickBaseline,
  type EstimateSummary,
} from "../_lib/estimate-api";
import { extractGanttChart } from "../_lib/gantt";
import type { PageRecord } from "../_lib/pages";

type Baseline =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; estimate: EstimateSummary | null };

export function editorHref(pageId: string): string {
  return `/overview/team/edit?from_document=${encodeURIComponent(pageId)}`;
}

export function EstimateSource({
  page,
  hold,
  reloadKey,
  uiBridgeId,
}: {
  page: PageRecord;
  hold: boolean;
  reloadKey: unknown;
  uiBridgeId: string;
}) {
  const canEdit = useCanEdit("estimates");
  const [baseline, setBaseline] = useState<Baseline>({ state: "loading" });

  useEffect(() => {
    if (hold) return;
    let live = true;
    setBaseline({ state: "loading" });
    fetchEstimates().then(
      (listed) =>
        live &&
        setBaseline({
          state: "ready",
          estimate: pickBaseline(listed.estimates),
        }),
      () => live && setBaseline({ state: "error" })
    );
    return () => {
      live = false;
    };
  }, [hold, reloadKey]);

  const isSource =
    baseline.state === "ready" && baseline.estimate?.source_page_id === page.id;
  // A reader is told only a fact; with nothing to say, nothing is shown.
  if (!canEdit && !isSource && baseline.state !== "error") return null;
  const hasChart = extractGanttChart(page.body_md ?? "") !== null;

  return (
    <section
      aria-labelledby={`${uiBridgeId}-heading`}
      className="space-y-2 text-sm"
      data-ui-bridge-id={uiBridgeId}
    >
      <h2
        id={`${uiBridgeId}-heading`}
        className="font-[family-name:var(--font-overview-serif)] text-lg text-foreground"
      >
        Project estimate
      </h2>
      {baseline.state === "error" && (
        <p
          className="text-muted-foreground"
          data-ui-bridge-id={`${uiBridgeId}.unknown`}
        >
          Whether this document is the estimate&rsquo;s source couldn&rsquo;t be
          checked right now.
        </p>
      )}
      {isSource && baseline.state === "ready" && baseline.estimate && (
        <p
          className="text-foreground"
          data-ui-bridge-id={`${uiBridgeId}.linked`}
        >
          This document is the source of the project&rsquo;s estimate, &ldquo;
          {baseline.estimate.name}&rdquo;.{" "}
          <Link
            href="/overview/team"
            className="text-primary underline-offset-4 hover:underline"
          >
            See it on the Team page
          </Link>
        </p>
      )}
      {canEdit && (
        <>
          <p className="text-muted-foreground">
            {hasChart
              ? "Its gantt chart can be imported as the estimate’s phases and tasks."
              : "It has no mermaid gantt chart, so its schedule is entered in the estimate by hand."}
          </p>
          <Link
            href={editorHref(page.id)}
            className="inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-ui-bridge-id={`${uiBridgeId}.use`}
          >
            {isSource
              ? "Update the estimate from it"
              : "Use as the project estimate"}
          </Link>
        </>
      )}
    </section>
  );
}
