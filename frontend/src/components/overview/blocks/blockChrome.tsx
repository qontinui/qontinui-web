"use client";

/**
 * The parts every live block shares: its frame, the notice it shows in place
 * of content, the states a report can be in before it is ready, and the line
 * naming which report and which stop a block shows.
 *
 * A block never renders a silent nothing (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2):
 * loading, a failed read, a report the project does not have and a block that
 * is not available yet each say so, in the overview's plain voice.
 */

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { describeFailure } from "@/components/overview/LoadFailure";
import { Provenance } from "@/components/presentation/Provenance";
import { formatDay } from "@/app/(app)/overview/_lib/timeline";
import { cn } from "@/lib/utils";
import type { ReportState, ViewSnapshot } from "./ReportContext";
import { Served, servedText } from "./served";
import { methodWords } from "./vocabulary";

/** The frame around one block, outside the document's prose styles. */
export function BlockFrame({
  name,
  uiBridgeId,
  label,
  children,
}: {
  /** The block's name (`report-scorecard`). */
  name: string;
  uiBridgeId: string;
  /** What the block is, for assistive technology. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="not-prose my-6 rounded-md border border-border p-4 text-sm"
      aria-label={label}
      data-overview-block={name}
      data-ui-bridge-id={uiBridgeId}
    >
      {children}
    </section>
  );
}

/** A plain-language notice standing in for a block's content. */
export function BlockNotice({
  title,
  detail,
  uiBridgeId,
  tone = "info",
  children,
}: {
  title: ReactNode;
  detail?: ReactNode;
  uiBridgeId?: string;
  /** `problem` for a block a writer must fix or a read that failed. */
  tone?: "info" | "problem";
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "border-l-2 pl-4",
        tone === "problem" ? "border-destructive" : "border-border"
      )}
      data-ui-bridge-id={uiBridgeId}
    >
      <p className="text-[15px] leading-relaxed text-foreground">{title}</p>
      {detail && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {detail}
        </p>
      )}
      {children}
    </div>
  );
}

/** A report that is not ready to show: loading, unreadable, or not there. */
export function ReportNotReady({
  state,
  uiBridgeId,
}: {
  state: Exclude<ReportState, { status: "ready" }>;
  uiBridgeId: string;
}) {
  if (state.status === "loading") {
    return (
      <div
        className="space-y-2"
        aria-busy
        aria-label="Loading the report"
        data-ui-bridge-id={`${uiBridgeId}.loading`}
      >
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (state.status === "missing") {
    return (
      <BlockNotice
        tone="problem"
        title={
          <>
            No report named <code>{state.slug}</code> in this project
          </>
        }
        detail="Check the report's name in this block's settings."
        uiBridgeId={`${uiBridgeId}.missing`}
      />
    );
  }
  return (
    <BlockNotice
      tone="problem"
      title="This report can't be read right now."
      detail={describeFailure(state.message)}
      uiBridgeId={`${uiBridgeId}.error`}
    >
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="inline-block cursor-pointer select-none rounded-sm py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Technical details
        </summary>
        <p className="mt-1 break-all font-mono">{state.message}</p>
      </details>
    </BlockNotice>
  );
}

/** "Baseline review, 13 Oct 2026 · Full review" — a stop in words. */
export function StopWords({ stop }: { stop: ViewSnapshot }) {
  return (
    <>
      <Served text={stop.label} />
      {", "}
      {formatDay(stop.as_of.slice(0, 10)) ?? "date unknown"}
      {" · "}
      {methodWords(stop.method_kind)}
    </>
  );
}

/**
 * Where a stop's figures came from and when they were true: how it was
 * measured, and its as-of (D5 — every figure, cell and item shows its source
 * and as-of). `persistent`, because overview pages are reading surfaces, not
 * lens pages.
 */
export function StopProvenance({ stop }: { stop: ViewSnapshot }) {
  return (
    <div className="mt-2">
      <Provenance
        persistent
        source={`${methodWords(stop.method_kind)}: ${servedText(stop.method_label)}`}
        asOf={stop.as_of}
      />
    </div>
  );
}

/** The line over a report block: which report, and which stop it shows. */
export function ReportContextLine({
  title,
  stop,
}: {
  title: string;
  stop: ViewSnapshot | null;
}) {
  return (
    <p className="mb-3 text-xs text-muted-foreground">
      <span className="text-foreground">
        <Served text={title} />
      </span>
      {stop ? (
        <>
          {" · "}
          <StopWords stop={stop} />
        </>
      ) : null}
    </p>
  );
}
