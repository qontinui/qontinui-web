"use client";

/**
 * The one statement that coord does not serve the spawn ledger, standing where
 * the ledger strip would be, with every section that rests on the ledger
 * collapsed under it (`ledgerServed.ts`): the strip itself, each path's "Last
 * spawned", what is in flight on each machine, where spawns were placed, the
 * spawn requests and the hourly rate. Each is named once, here, and not
 * rendered as a column or a section of UNKNOWNs.
 */

import { AlertTriangle } from "lucide-react";
import { UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";
import { spawnIssueTextFor, type SpawnReadIssue } from "../_lib/spawnStatus";
import { IN_FLIGHT_UNKNOWN } from "../_lib/machineStatus";

/** What the page leaves out while the ledger is not served, in page order. */
export const LEDGER_DEPENDENTS = [
  "the ledger figures (requested, started, time to spawn, outcomes)",
  "when each path last started a session",
  "where spawns were placed",
  "how many requests there were and how they ended",
  "the hourly rate of requests and starts",
] as const;

export function LedgerUnservedNotice({
  issue,
  presenting,
}: {
  issue: SpawnReadIssue;
  presenting: boolean;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        UNKNOWN_AMBER
      )}
      data-testid="coord-spawns-ledger-unserved"
      data-ui-bridge-id="coord-spawns-ledger-unserved"
      data-issue={issue.kind}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="m-0">
          {spawnIssueTextFor(issue, "the spawn activity", presenting)}
        </p>
        <p className="m-0 text-xs" data-testid="coord-spawns-ledger-dependents">
          Until it is, this page does not show {LEDGER_DEPENDENTS.join("; ")}.
          What is in flight on each machine against its ceiling is not shown
          either:{" "}
          {presenting
            ? IN_FLIGHT_UNKNOWN.presented
            : IN_FLIGHT_UNKNOWN.operator}
        </p>
      </div>
    </div>
  );
}
