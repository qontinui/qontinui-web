"use client";

import { AlertTriangle, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanRoots } from "../_hooks/usePlanLibrary";
import { scanRootStateLabel, type ScanRootRow } from "../types";

/**
 * `n` seconds as a short duration. Whole units only — this is a health
 * reading, not a stopwatch, and "2h" is easier to compare across eight rows
 * than "2h 14m 9s".
 */
export function shortDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/**
 * How far this device's scanned tree is from its default branch, in words.
 *
 * Three rules, all of them load-bearing, all of them the reason the backend
 * carries `counts_are_floors` beside the counts rather than just the numbers:
 *
 * * A `null` count is NOT MEASURED and must never render as `0`. A defaulted
 *   zero is exactly the false "in step" this whole feature exists to remove.
 * * A FLOOR renders as "at least N" — the counts were taken against a ref that
 *   is stale or of unknown age, so they are lower bounds.
 * * Only an EXACT `0` behind may read as "in step". A floor of 0 behind is a
 *   lower bound of nothing, and the backend has already turned that row's
 *   verdict into `unknown` / `ref_stale:`; this function must not contradict
 *   it by printing agreement beside it.
 */
export function driftSummary(row: ScanRootRow): string {
  if (row.behind == null) return "Distance not measured.";
  const floor = row.counts_are_floors;
  if (row.behind === 0 && !floor) {
    return row.ahead ? `In step, ${row.ahead} ahead.` : "In step with its ref.";
  }
  const at = floor ? "At least " : "";
  const behind = `${at}${row.behind} behind`;
  const ahead = row.ahead
    ? `, ${floor ? "at least " : ""}${row.ahead} ahead`
    : "";
  const floors = floor ? " (lower bounds — the ref itself may be stale)" : "";
  return `${behind}${ahead}${floors}.`;
}

/**
 * One device's row.
 *
 * Keys on `state` — the READ ROUTE'S VERDICT — and never on `reported_state`.
 * When the two disagree the verdict wins and the reported pair is shown BELOW
 * it, labelled as what the device said, so an operator can see both without
 * being able to mistake one for the other. That disagreement is the normal
 * case for a device that has gone quiet: it last reported `measured` and the
 * verdict is `unknown`, and rendering the reported value as the answer is the
 * defect this panel is here to avoid.
 */
function ScanRootRowView({ row }: { row: ScanRootRow }) {
  const verdictDiffers =
    row.state !== row.reported_state || row.detail !== row.reported_detail;

  return (
    <div
      className="border-t border-border/60 px-3 py-2.5 text-xs first:border-t-0"
      data-testid={`scan-root-${row.device_id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={row.state === "measured" ? "outline" : "secondary"}
          className="shrink-0"
          data-testid={`scan-root-state-${row.device_id}`}
        >
          {scanRootStateLabel(row.state)}
        </Badge>
        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {row.device_id.slice(0, 8)}
        </code>
        <span className="truncate text-muted-foreground">
          {row.source_repo ?? row.plans_dir ?? "scan root not reported"}
        </span>
        <span
          className="ml-auto shrink-0 text-muted-foreground"
          data-testid={`scan-root-age-${row.device_id}`}
        >
          {row.observation_fresh
            ? `heard ${shortDuration(row.observation_age_secs)} ago`
            : `silent ${shortDuration(row.observation_age_secs)}`}
        </span>
      </div>

      <p
        className="mt-1 text-[11px] text-muted-foreground"
        data-testid={`scan-root-drift-${row.device_id}`}
      >
        {driftSummary(row)}
        {row.default_ref ? ` Against ${row.default_ref}.` : ""}
        {row.ref_age_secs != null
          ? ` Ref last known refreshed ${shortDuration(row.ref_age_secs)} ago.`
          : ""}
      </p>

      {row.detail && (
        <p
          className="mt-1 text-[11px] text-amber-700 dark:text-amber-300"
          data-testid={`scan-root-detail-${row.device_id}`}
        >
          {row.detail}
        </p>
      )}

      {verdictDiffers && (
        <p
          className="mt-1 text-[11px] text-muted-foreground"
          data-testid={`scan-root-reported-${row.device_id}`}
        >
          The device reported{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            {scanRootStateLabel(row.reported_state)}
          </code>
          {row.reported_detail ? `: ${row.reported_detail}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * How current is the tree each device scans to feed this corpus.
 *
 * The sibling of Capture health, and the other half of one question. Capture
 * health says WHICH DOOR wrote the rows; this says HOW STALE the working tree
 * behind the biggest of those doors — the runner scan — was when it wrote
 * them. Neither answers the other: a body sync reporting `errors=0` on every
 * cycle while its checkout sat 254 commits behind left the corpus 54 plans
 * short, and nothing on the read side could see it (plan
 * `2026-09-11-the-plan-corpus-scan-root-does-not-report-its-own-drift`).
 *
 * Three absences this panel refuses to render as agreement, each mirroring the
 * backend rule that produces it:
 *
 * * **No rows at all** is UNKNOWN, never "every feeder is current". A runner
 *   whose build predates the report, or whose body sync is off, sends nothing,
 *   and that is indistinguishable here from a fleet with no drift.
 * * **A read that failed** leaves the previous rows on screen and says they
 *   may be stale — it does not blank them into a false zero.
 * * **Every feeder quiet** (`count > 0`, `fresh_count === 0`) is called out on
 *   its own line, because a list of rows that all say `unknown` reads, at a
 *   glance, like a list of rows.
 */
export function ScanSourcesPanel() {
  const { data, loading, error } = useScanRoots();

  const allQuiet = data != null && data.count > 0 && data.fresh_count === 0;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="scan-sources"
    >
      <div className="flex items-start gap-3">
        <GitBranch className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">Scan sources</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            How far the working tree each device scans sits from its default
            branch. A sync that reports no errors while reading a tree hundreds
            of commits behind still leaves the corpus short — the count of
            captured artifacts cannot show that, and this can.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
          data-testid="scan-sources-error"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Couldn&apos;t read scan sources: {error}.{" "}
            {data
              ? "The readings below are the last ones read and may be stale."
              : "No readings could be read — how current the corpus's feeders are is unknown, not current."}
          </p>
        </div>
      )}

      {loading && !data ? (
        <Skeleton className="mt-4 h-20 w-full" />
      ) : data == null ? null : data.state === "unknown" ? (
        <p
          className="mt-3 text-xs text-muted-foreground"
          data-testid="scan-sources-none"
        >
          {data.detail ??
            "No device has reported a scan-source reading for this organization, so whether the corpus's feeders are current is not established. An empty list is not “every feeder is current”."}
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-hidden rounded-md border border-border bg-background">
            {data.rows.map((row) => (
              <ScanRootRowView key={row.device_id} row={row} />
            ))}
          </div>
          <p
            className="mt-2 text-[11px] text-muted-foreground"
            data-testid="scan-sources-summary"
          >
            {data.fresh_count} of {data.count} device
            {data.count === 1 ? "" : "s"} reported within the last{" "}
            {shortDuration(data.fresh_within_secs)}.
            {allQuiet
              ? " Every feeder has gone quiet — none of these readings says anything about now."
              : ""}
          </p>
        </>
      )}
    </section>
  );
}
