"use client";

/**
 * SourceUnknown — what a UI Bridge dashboard panel renders in place of an
 * answer it does not have: the word UNKNOWN on R3's ignorance-floor amber,
 * and the reason (common brief rule 12 — never an empty panel, a zero or a
 * "clear"). The reason comes from `relaySource.ts`, so every panel names the
 * same failure the same way, the runner's build included.
 *
 * A request id, when the failure carried one, rides on the last line in the
 * raw-id style (R5) — it is what the backend log is grepped for.
 */

import { Badge } from "@/components/ui/badge";
import { UNKNOWN_AMBER, relativeTime } from "@/components/console";
import { cn } from "@/lib/utils";
import type { RunnerRoute } from "../_lib/relayReads";
import {
  UNKNOWN_WORD,
  sourceIssueText,
  type BuildReading,
  type SourceIssue,
} from "../_lib/relaySource";

export interface SourceUnknownProps {
  /** The reason, a full sentence (`sourceIssueText`). */
  text: string;
  requestId?: string | null;
  className?: string;
  "data-testid"?: string;
}

export function SourceUnknown({
  text,
  requestId,
  className,
  "data-testid": testId,
}: SourceUnknownProps) {
  return (
    <div
      className={cn("flex items-start gap-2 text-sm", className)}
      data-testid={testId}
      data-source-unknown=""
      // A read settling into UNKNOWN replaces nothing on screen; `status`
      // (polite) is what tells a screen reader the panel answered.
      role="status"
    >
      <Badge
        variant="outline"
        className={cn("shrink-0 text-[11px] font-semibold", UNKNOWN_AMBER)}
      >
        {UNKNOWN_WORD}
      </Badge>
      <div className="min-w-0 space-y-0.5">
        <p className="m-0 text-muted-foreground">{text}</p>
        {requestId && (
          <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
            request {requestId}
          </p>
        )}
      </div>
    </div>
  );
}

export interface RunnerReadUnknownProps {
  issue: SourceIssue;
  route: RunnerRoute;
  build: BuildReading;
  className?: string;
  "data-testid"?: string;
}

/** The labelled UNKNOWN for one runner read that has no answer. */
export function RunnerReadUnknown({
  issue,
  route,
  build,
  className,
  "data-testid": testId,
}: RunnerReadUnknownProps) {
  return (
    <SourceUnknown
      text={sourceIssueText(issue, route, build)}
      requestId={issue.kind === "failed" ? issue.requestId : null}
      className={className}
      data-testid={testId}
    />
  );
}

/**
 * The note a panel shows over a KEPT value whose latest refresh failed (R6):
 * the figures are an earlier read's, said in words, never passed off as
 * re-confirmed.
 */
export function StaleReadNote({
  asOf,
  "data-testid": testId,
}: {
  asOf: number | null;
  "data-testid"?: string;
}) {
  return (
    <p
      className="m-0 text-xs text-muted-foreground"
      role="status"
      data-testid={testId}
      data-stale-read=""
    >
      The last refresh failed — these figures are from the read{" "}
      {asOf === null ? "before it" : relativeTime(new Date(asOf).toISOString())}
      .
    </p>
  );
}
