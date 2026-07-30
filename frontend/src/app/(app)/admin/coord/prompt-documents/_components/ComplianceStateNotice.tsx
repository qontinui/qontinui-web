"use client";

import { AlertTriangle, CloudOff, Info } from "lucide-react";

interface ComplianceStateNoticeProps {
  /** Coord doesn't serve this route yet (404/405) — not an outage. */
  unavailable: boolean;
  /** Coord answered, but its compliance store isn't provisioned. */
  degraded: string | null;
  /** Coord unreachable or refusing — we know nothing. */
  error: string | null;
  /** What the surface would have shown, e.g. "session verdicts". */
  what: string;
}

/**
 * The one honest "why is there nothing here" banner, shared by all three
 * compliance surfaces.
 *
 * Each state is rendered as its own sentence rather than collapsed into an
 * empty list, because they are not the same claim: "coord doesn't have this
 * feature yet", "coord can't see its store", and "coord didn't answer" all mean
 * we don't know — whereas an empty table asserts that nothing happened.
 * Returns `null` when there is nothing to declare.
 */
export function ComplianceStateNotice({
  unavailable,
  degraded,
  error,
  what,
}: ComplianceStateNoticeProps) {
  if (unavailable) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
        data-testid="compliance-unavailable"
      >
        <CloudOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Coord doesn&apos;t serve the session-compliance routes yet, so no{" "}
          {what} can be read. This panel is empty because the data
          isn&apos;t reachable — not because nothing has happened.
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5"
        data-testid="compliance-error"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Couldn&apos;t reach coord for {what}: {error}.
        </p>
      </div>
    );
  }
  if (degraded) {
    return (
      <div
        className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
        data-testid="compliance-degraded"
      >
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Coord reports its session-compliance store isn&apos;t provisioned yet (
          {degraded}). The {what} shown here may be incomplete for that reason.
        </p>
      </div>
    );
  }
  return null;
}
