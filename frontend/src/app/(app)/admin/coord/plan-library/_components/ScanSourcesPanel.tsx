"use client";

import { AlertTriangle, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanRoots } from "../_hooks/usePlanLibrary";
import { scanRootStateLabel, type ScanRootRow } from "../types";

/**
 * `n` seconds as a short duration that never over- or under-states it.
 *
 * Whole units only — this is a health reading, not a stopwatch, and "2h" is
 * easier to compare across eight rows than "2h 14m 9s". The rounding is the
 * load-bearing part, and neither obvious choice is right:
 *
 * * FLOORING under-states an age, so a feeder silent 23h59m reads `23h` and
 *   looks more current than it is.
 * * CEILING over-states it by up to a whole unit — 1h0m1s silent would read
 *   `2h`, a ~60% exaggeration, and a figure nobody can trust in the loud
 *   direction is only marginally better than one nobody can trust in the
 *   quiet one.
 *
 * So: floor the unit and append `+` when anything was dropped. `1h+` is "at
 * least an hour", which is true, bounded, and the same hedge
 * [`driftSummary`] puts on a floor count. An exact value carries no `+`, so
 * the freshness window (2700 s) still reads plainly as `45m`.
 */
export function shortDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const unit = (size: number, suffix: string) =>
    `${Math.floor(s / size)}${suffix}${s % size ? "+" : ""}`;
  if (s < 60) return `${s}s`;
  if (s < 3600) return unit(60, "m");
  if (s < 86_400) return unit(3600, "h");
  return unit(86_400, "d");
}

/**
 * The one `unknown` rule that leaves the reading CURRENT, named by its own
 * `detail` prefix rather than inferred.
 *
 * The route publishes which rule fired — every `unknown` detail starts
 * `observation_stale:`, `reading_superseded:` or `ref_stale:` — and this reads
 * that discriminator instead of reconstructing it from the raw fields. The
 * difference only shows up on a rule that does not exist yet: were a FOURTH
 * `unknown` rule added that implies neither silence, nor supersession, nor a
 * floor, a field-inferred test would call its row current and print its counts
 * in the present tense with no hedge — the round-1 defect, re-entered through
 * the door the round-1 fix left open. An unrecognised reason is treated as not
 * current, which is the conservative arm: a hedge on a row that did not need
 * one costs an operator nothing.
 */
const REF_STALE_PREFIX = "ref_stale:";

/**
 * Is the STORED reading still the device's current word?
 *
 * This gates TENSE, and it is deliberately not `state === "measured"`. The
 * route's three `unknown` rules do not all mean the same thing about the
 * reading's age, and collapsing them mis-describes one of the three:
 *
 * * `observation_stale:` — the device went silent. The reading is old. Past.
 * * `reading_superseded:` — its latest report contradicts the stored reading,
 *   so the stored one is by construction not its latest word. Past.
 * * `ref_stale:` — a 0-behind FLOOR. The device reported it moments ago and is
 *   perfectly live; what is stale is the REF it measured against. Writing
 *   "When last measured" here would invent a silence that is not there and
 *   point the operator at the wrong device.
 *
 * So tense keys on the two clocks that actually say whether the reading is the
 * device's latest word, AND — for a row the verdict has disowned — on the
 * route naming a reason that is compatible with it still being current. The
 * separate question "may this sentence claim agreement?" keys on the verdict,
 * in [`driftSummary`] below.
 */
function readingIsCurrent(row: ScanRootRow): boolean {
  if (!row.observation_fresh || !row.last_report_applied) return false;
  if (row.state === "measured") return true;
  return (row.detail ?? "").startsWith(REF_STALE_PREFIX);
}

/**
 * How far this device's scanned tree is from its default branch, in words.
 *
 * Four rules, all load-bearing, all the reason the backend carries a verdict
 * and a floors flag beside the raw counts rather than just the numbers:
 *
 * * **Agreement is claimed only on a verdict that supports it.** The counts
 *   arrive whatever the verdict — the route serves them verbatim — so `state`
 *   has to be consulted, not just the numbers. Without this a device silent
 *   for 2.5 hours whose last reading was 0/0 rendered "In step with its ref."
 *   directly beneath a badge reading `Unknown`: a confident present-tense
 *   claim of agreement about a feeder that has established nothing, which is
 *   the exact defect this whole feature exists to remove.
 * * **A reading that is not the device's latest word is written in the past
 *   tense**, on the [`readingIsCurrent`] test above — which is a different
 *   question from the one on the line before, and answered by different
 *   fields. A `ref_stale` row is disowned AND current.
 * * **A `null` count is NOT MEASURED and must never render as `0`** — `behind`
 *   and `ahead` alike.
 * * **A FLOOR renders as "at least N"** — the counts were taken against a ref
 *   that is stale or of unknown age, so they are lower bounds.
 * * **Only an EXACT `0` behind may read "in step".** A floor of 0 behind is a
 *   lower bound of nothing, and the route has already turned that row's
 *   verdict into `unknown` / `ref_stale:`.
 */
export function driftSummary(row: ScanRootRow): string {
  if (row.behind == null) return "Distance not measured.";
  const floor = row.counts_are_floors;
  const current = readingIsCurrent(row);
  const mayClaimAgreement = row.state === "measured" && current;

  if (row.behind === 0 && !floor && mayClaimAgreement) {
    if (row.ahead == null) return "Not behind its ref; ahead not measured.";
    return row.ahead ? `In step, ${row.ahead} ahead.` : "In step with its ref.";
  }

  const at = floor ? "at least " : "";
  const behind = `${at}${row.behind} behind`;
  const ahead =
    row.ahead == null
      ? ", ahead not measured"
      : row.ahead || !current
        ? // On the past-tense path a measured `0 ahead` is kept rather than
          // dropped: the present-tense path says it through "In step with its
          // ref", and nothing says it here unless it is written out.
          `, ${at}${row.ahead} ahead`
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

/**
 * The clock-skew sentence, or `null` when the skew is ordinary drift.
 *
 * Both halves are written as statements about the READING, never about the
 * device's clock now. Skew is stored per row and does not decay, so on a
 * device silent for days "the runner's clock IS 2m ahead" asserts a present
 * fact from a row that establishes nothing about the present — the same
 * mistake the counts are guarded against two functions up. The clock may well
 * have been fixed since.
 *
 * The positive branch's cause list is gated on `last_report_applied`, because
 * the backend names THREE causes and the third one co-occurs with a verdict
 * already on screen: on a superseded row `received_at` is the DECLINED
 * report's arrival while `observed_at` belongs to the older stored reading, so
 * a large positive skew there is bookkeeping rather than a clock problem.
 * Offering "a runner clock behind this one, or a late delivery" directly above
 * a detail line reading `reading_superseded:` would be two explanations, both
 * wrong.
 */
function skewSummary(row: ScanRootRow): string | null {
  const skew = row.observed_skew_secs;
  if (Math.abs(skew) < SKEW_WORTH_REPORTING_SECS) return null;
  if (skew < 0) {
    return `The runner's clock was ${shortDuration(-skew)} ahead of this server's when it reported.`;
  }
  return row.last_report_applied
    ? `This reading reached the server ${shortDuration(skew)} after the runner took it — a runner clock behind this one, or a late delivery.`
    : `This reading is ${shortDuration(skew)} older than the device's last contact, which is what a superseded reading looks like rather than a clock problem.`;
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
 * "as of HH:MM:SS" — the moment every age on this panel was measured.
 *
 * Small, and the whole reason the ages above it can be trusted. Without it a
 * figure computed once keeps being read as though it were computed now.
 */
function ReadAt({ at }: { at: Date | null }) {
  if (!at) return null;
  return (
    <span data-testid="scan-sources-read-at">
      {" "}
      Read at {at.toLocaleTimeString()}; the ages above are as of then.
    </span>
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
 *
 * And a fourth, which is the same rule one level up. Every age on this panel —
 * `observation_age_secs`, `observation_fresh`, `fresh_count` — is a
 * SERVER-COMPUTED DELTA frozen at fetch time, and this panel does not poll. A
 * console left open overnight would otherwise keep reading "heard 30s ago",
 * which is a stale reading rendered as current: the feature's own thesis,
 * failing at the panel rather than at the row. So every figure is stamped with
 * the moment it was read, and the refresh that makes the stamp actionable sits
 * next to it. The stamp is deliberately the READ time and not a client-side
 * re-computation of each age: the route is explicit that only the server's
 * clock is trusted for liveness, and aging the rows here would quietly
 * substitute the browser's.
 */
export function ScanSourcesPanel() {
  const { data, fetchedAt, loading, error, reload } = useScanRoots();

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
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Scan sources</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            How far the working tree each device scans sits from its default
            branch. A sync that reports no errors while reading a tree hundreds
            of commits behind still leaves the corpus short — the count of
            captured artifacts cannot show that, and this can.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 shrink-0 px-2 text-xs"
          onClick={() => reload()}
          disabled={loading}
          data-testid="scan-sources-refresh"
        >
          <RefreshCw className="size-3" aria-hidden />
          Refresh
        </Button>
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
        <Skeleton
          className="mt-4 h-20 w-full"
          data-testid="scan-sources-loading"
        />
      ) : data == null ? null : empty ? (
        <p
          className="mt-3 text-xs text-muted-foreground"
          data-testid="scan-sources-none"
        >
          {data.detail ??
            "No device has reported a scan-source reading for this organization, so whether the corpus's feeders are current is not established. An empty list is not “every feeder is current”."}
          <ReadAt at={fetchedAt} />
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
            <ReadAt at={fetchedAt} />
          </p>
        </>
      )}
    </section>
  );
}
