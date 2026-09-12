"use client";

import { AlertTriangle, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanRoots } from "../_hooks/usePlanLibrary";
import { scanRootStateLabel, type ScanRootRow } from "../types";

/**
 * `n` seconds as a short duration, ROUNDED UP.
 *
 * Whole units only — this is a health reading, not a stopwatch, and "2h" is
 * easier to compare across eight rows than "2h 14m 9s".
 *
 * Rounding up rather than down is the load-bearing half. Every use here is an
 * AGE — how long a device has been silent, how old the ref it measured against
 * was — so flooring makes a feeder look more current than it is: 23h59m silent
 * would read `23h`, and 1d23h would read `1d`. The error has to fall on the
 * conservative side of the claim, which for an age means over-stating it.
 */
export function shortDuration(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86_400) return `${Math.ceil(s / 3600)}h`;
  return `${Math.ceil(s / 86_400)}d`;
}

/**
 * Is this row's reading a claim about NOW?
 *
 * True only when the READ ROUTE'S VERDICT is still `measured`. The route sets
 * `state: "unknown"` for each of its three rules — the device went silent
 * (`observation_stale:`), its latest report contradicts the stored reading
 * (`reading_superseded:`), or the counts are a 0-behind floor (`ref_stale:`) —
 * and its own row docstring warns that the counts are "served as reported
 * whatever the verdict", so the numbers survive a verdict that disowns them.
 * Every present-tense sentence in this file is gated on this.
 */
function isCurrent(row: ScanRootRow): boolean {
  return row.state === "measured";
}

/**
 * How far this device's scanned tree is from its default branch, in words.
 *
 * Four rules, all load-bearing, all the reason the backend carries a verdict
 * and a floors flag beside the raw counts rather than just the numbers:
 *
 * * **A count the verdict disowns is never a present-tense claim.** When
 *   `state` is not `measured` the counts still arrive — the route serves them
 *   verbatim — but they describe a past reading, so they are rendered as one
 *   ("When last measured: …") and the agreement phrasing is withheld entirely.
 *   Without this a device silent for 2.5 hours whose last reading was 0/0
 *   rendered "In step with its ref." directly beneath a badge reading
 *   `Unknown` — a confident present-tense claim of agreement about a feeder
 *   that has established nothing, which is the exact defect this whole feature
 *   exists to remove.
 * * **A `null` count is NOT MEASURED and must never render as `0`** — `behind`
 *   and `ahead` alike.
 * * **A FLOOR renders as "at least N"** — the counts were taken against a ref
 *   that is stale or of unknown age, so they are lower bounds.
 * * **Only an EXACT `0` behind, on a current verdict, may read "in step".** A
 *   floor of 0 behind is a lower bound of nothing, and the route has already
 *   turned that row's verdict into `unknown` / `ref_stale:`.
 */
export function driftSummary(row: ScanRootRow): string {
  if (row.behind == null) return "Distance not measured.";
  const floor = row.counts_are_floors;
  const current = isCurrent(row);

  if (row.behind === 0 && !floor && current) {
    if (row.ahead == null) return "Not behind its ref; ahead not measured.";
    return row.ahead ? `In step, ${row.ahead} ahead.` : "In step with its ref.";
  }

  const at = floor ? "at least " : "";
  const behind = `${at}${row.behind} behind`;
  const ahead =
    row.ahead == null
      ? ", ahead not measured"
      : row.ahead
        ? `, ${at}${row.ahead} ahead`
        : "";
  const floors = floor ? " (lower bounds — the ref itself may be stale)" : "";
  const clause = `${behind}${ahead}${floors}`;

  // Past tense, and explicitly so, whenever the verdict disowns the numbers.
  return current
    ? `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`
    : `When last measured: ${clause}.`;
}

/**
 * The ref-age sentence, or `null` when there is no age to report.
 *
 * Phrased as of the READING, never as of now. `ref_age_secs` was measured at
 * `observed_at`, so on a row the device has not refreshed in hours "Ref last
 * known refreshed 2m ago" is a floor rendered as an exact present-tense fact —
 * the same mistake the counts are guarded against one function up.
 */
export function refAgeSummary(row: ScanRootRow): string | null {
  if (row.ref_age_secs == null) return null;
  return `Ref was ${shortDuration(row.ref_age_secs)} old at that reading.`;
}

/**
 * How visually loud a verdict should be.
 *
 * `unknown` gets its own weight. It is the verdict meaning "this row
 * establishes nothing", and rendering it in the same `secondary` grey as
 * `not_scanning` — a settled, benign fact — makes the row that needs a second
 * look read like the row that does not.
 */
function stateVariant(state: ScanRootRow["state"]) {
  if (state === "measured") return "outline" as const;
  if (state === "unknown") return "warning" as const;
  return "secondary" as const;
}

/**
 * A runner clock far enough from this server's to be worth naming.
 *
 * The backend keeps `observed_skew_secs` precisely so a skewed clock is
 * visible rather than silently aging a live device out or pinning its row, and
 * it is a write-side refusal past +300 s. Under a minute is ordinary NTP
 * drift and not worth a line.
 */
const SKEW_WORTH_REPORTING_SECS = 60;

function skewSummary(row: ScanRootRow): string | null {
  const skew = row.observed_skew_secs;
  if (Math.abs(skew) < SKEW_WORTH_REPORTING_SECS) return null;
  return skew > 0
    ? `The reading reached this server ${shortDuration(skew)} after the runner took it — a runner clock behind this one, or a late delivery.`
    : `The runner's clock is ${shortDuration(-skew)} ahead of this server's.`;
}

/**
 * One device's row.
 *
 * Keys on `state` — the READ ROUTE'S VERDICT — and never on `reported_state`,
 * and that holds for the prose as well as for the badge: `driftSummary` and
 * `refAgeSummary` both take the whole row so they can consult the verdict too.
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
  const refAge = refAgeSummary(row);
  const skew = skewSummary(row);

  return (
    <div
      className="border-t border-border/60 px-3 py-2.5 text-xs first:border-t-0"
      data-testid={`scan-root-${row.device_id}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={stateVariant(row.state)}
          className="shrink-0"
          data-testid={`scan-root-state-${row.device_id}`}
        >
          {scanRootStateLabel(row.state)}
        </Badge>
        {/* Truncated to fit the row; the full id is on the title so an
            operator can identify the device without hitting the API. */}
        <code
          className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px]"
          title={row.device_id}
        >
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
        {refAge ? ` ${refAge}` : ""}
      </p>

      {row.detail && (
        <p
          className="mt-1 text-[11px] text-amber-700 dark:text-amber-300"
          data-testid={`scan-root-detail-${row.device_id}`}
        >
          {row.detail}
        </p>
      )}

      {skew && (
        <p
          className="mt-1 text-[11px] text-muted-foreground"
          data-testid={`scan-root-skew-${row.device_id}`}
        >
          {skew}
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
  // The empty branch is chosen by the ROWS, not by the top-level `state`.
  // Today the route only answers `unknown` when it has no rows, but nothing in
  // the wire type ties the two, and keying on `state` would silently render
  // "no device has reported" OVER rows that exist — a false absence, which is
  // the failure this panel is built to avoid rather than to introduce.
  const empty = data != null && data.rows.length === 0;

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
      ) : data == null ? null : empty ? (
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
