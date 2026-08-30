"use client";

/**
 * Per-machine resource strip + sparklines (plan
 * `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C1/§C3).
 *
 * One row per `(device, lane, lane_instance)` — **never summed across
 * lanes**. `.wslconfig` caps WSL at a fraction of physical RAM, so the host
 * and WSL samplers measure different pools; a single "machine RAM" figure is
 * not merely imprecise, it is uninterpretable.
 *
 * ## What the lead column is, and what it is not
 *
 * The lead column is the lane's **pressure ratio**, and it arrives
 * SERVER-COMPUTED from coord (`device_resource_samples::lane_pressure`) — the
 * same function §B1's CI ranker orders on. Nothing here recalculates it. If
 * the dashboard and the dispatcher each derived "how loaded is this machine",
 * they could disagree, which is the precise failure this plan exists to end.
 *
 * It is NOT `mem_available`. On a saturated box `mem_available` is pinned by
 * the kernel reserve and reads as an all-clear (−13.5 ± 11.2 M/day,
 * indistinguishable from zero) while swap moved +138.6 ± 41.7 M/day over the
 * same runs. This fleet has already shipped one dashboard that led on the
 * pinned number.
 *
 * ## Pressure is the magnitude; `headroom` is the colour
 *
 * Pressure says how loaded a lane is. It does **not** say whether the lane
 * will accept work — coord admits on **byte floors**, on columns the ratio
 * does not even divide by. So the row's tone comes from the server's
 * `headroom` verdict and the floor beside it, and the pressure percentage is
 * rendered in neutral type. The band constants that used to colour this table
 * (`SATURATED_AT` / `WARN_AT`, decided in TypeScript) are deleted: they could
 * paint a row amber that the ranker had already stopped electing.
 *
 * ## The §C3 honesty rules this file implements
 *
 * - A machine with **no recent sample** renders `unknown`, never `healthy`.
 *   The device list is the spine, so a machine that stops publishing appears
 *   as unknown rather than vanishing (`buildMachineGroups`).
 * - A **stale** sample renders AS STALE — the value is demoted and dated, not
 *   presented as current. The 2026-08-02 misdiagnosis came from trusting a
 *   number that had stopped being true.
 * - `pressure: null` is **no server opinion**, rendered unknown — never 0,
 *   never green.
 * - `headroom` absent or `unknown` gets **the same treatment as a stale or
 *   absent sample** — the neutral unknown tone, never green. A coord that has
 *   not shipped the floor fields yet paints the fleet grey, not healthy.
 * - **No MEASURED swap figure appears on a `host` row.** Windows derives swap
 *   algebraically from the same commit counters, so printing both would read
 *   as corroboration from two instruments when it is one printed twice. The
 *   lead column IS the swap-or-commit figure; there is no second one.
 *   One deliberate exception: a swap-ratio THRESHOLD coord actually reports
 *   for such a lane is still shown (with a note that the row's pressure
 *   figure is a different instrument), because withholding a rule the
 *   dispatcher enforces is the worse error. A threshold is not a measurement.
 * - **The SATURATION axis renders `unknown`, never green, until each machine's
 *   runner is rebuilt.** Added by plan
 *   `2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory`: a
 *   pre-Phase-3 publisher sends NULL task counts, so every lane in the fleet
 *   reads unknown on this column through the whole activation window, and no
 *   running runner may be restarted to hurry that. That window must not be
 *   papered over with an `ok` — it is the state the `runner_served_sha` gate
 *   exists to watch. Its unknown-ness also does NOT destroy the memory and
 *   disk verdicts on the same row; coord skips grading an axis nothing
 *   measured, and the row keeps the verdicts it can honestly make.
 * - A `wsl` lane's headroom is never shown as spendable on its own: WSL handing
 *   idle pages back to Windows couples the lanes, so the coupled
 *   `min(wsl_free, host_free_commit)` is shown beside the raw figure. Do NOT
 *   re-attribute that reclaim to a `.wslconfig` `pageReporting=true` key: on
 *   WSL 2.7.12.0 the key is not recognised at all, and neither fleet box sets
 *   it. That reclaim is on by *default* remains presumed, not measured — an
 *   assumption this surface rests on. See
 *   `qontinui-claude-config/knowledge-base/qontinui-specific/machine-resources.md`
 *   §2.
 * - Every figure is a **ratio against its own ceiling**; bare byte counts only
 *   ever appear next to the ratio that gives them meaning.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, Gauge, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CollapsiblePanel } from "@/components/console";
import { deviceStateBadgeVariant } from "./FleetHealthSummary";
import {
  buildMachineGroups,
  classifySaturation,
  coupledWslHeadroomBytes,
  describeFloor,
  describePressureFloor,
  formatAge,
  formatBytes,
  formatPercent,
  formatRatioOfCeiling,
  formatSaturationCounts,
  formatWarnMargin,
  FLOOR_VERDICT_HINT,
  hasPressureValue,
  hasSaturationValue,
  headroomReport,
  headroomTone,
  HEADROOM_LABEL,
  HEADROOM_MEANING,
  hostIsBindingConstraint,
  laneShowsSwap,
  pressureAxisIsSwap,
  pressureAxisLabel,
  pressureFormula,
  pressureLabel,
  rowAnchor,
  rowHeadroom,
  safeRatio,
  SATURATION_REPORT_MEANING,
  saturationSourceLabel,
  STALE_AFTER_SECS,
} from "./fleetResources";
import type {
  FleetDeviceRef,
  FloorDetail,
  Headroom,
  HistorySeries,
  ResourceSampleRow,
  RowTone,
  StripRow,
} from "./fleetResources";
import type { UseFleetResourceSamplesResult } from "./useFleetResourceSamples";

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

const TONE_DOT: Record<RowTone, string> = {
  ok: "bg-green-500",
  warn: "bg-yellow-500",
  critical: "bg-red-500",
  unknown: "bg-muted-foreground/50",
};

// There is deliberately no tone map for the PRESSURE text any more. Colouring
// the magnitude was how a client-side band leaked back into the verdict; the
// ratio now renders in neutral type and the Admission column carries tone.

/**
 * The row's own tone stripe. `unknown` gets the SAME muted treatment as a
 * stale row — deliberately not a colour that reads as an all-clear.
 */
const TONE_ROW: Record<RowTone, string> = {
  ok: "border-l-2 border-l-green-500/60",
  warn: "border-l-2 border-l-yellow-500",
  critical: "border-l-2 border-l-red-500",
  // A neutral grey from the palette rather than `border-l-muted-foreground`:
  // the theme-token guard reads the directional utility's token as
  // `l-muted-foreground`, which the theme does not define. The tone dots in
  // this file already use palette colours for the same reason.
  unknown: "border-l-2 border-l-zinc-400/50",
};

const TONE_BADGE: Record<
  RowTone,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ok: "secondary",
  warn: "secondary",
  critical: "destructive",
  unknown: "outline",
};

const SPARK_STROKE: Record<RowTone, string> = {
  ok: "var(--chart-2, #22c55e)",
  warn: "#eab308",
  critical: "#ef4444",
  unknown: "currentColor",
};

// ---------------------------------------------------------------------------
// Sparkline — "spiky" vs "saturated" is the whole point
// ---------------------------------------------------------------------------

/**
 * A pressure sparkline over the retention window.
 *
 * The Y domain is **pinned to [0, 1]**. Auto-scaling would draw a machine flat
 * at 5% and a machine flat at 95% as the same picture — and "spiky vs
 * saturated" is exactly the distinction that decides whether to drain a
 * machine.
 *
 * There is **no threshold reference line**. There used to be one, drawn at a
 * client-side `SATURATED_AT`; the floor coord actually admits on is a byte
 * count on a different column, so it has no honest Y position on a pressure
 * axis. Drawing a line where nothing happens is the same lie as colouring a
 * row from it. The stroke colour carries the server's verdict instead.
 *
 * Null points are gaps (`connectNulls={false}`): a period where the server
 * had no pressure opinion must not be drawn as a straight line between two
 * readings that never met.
 */
function PressureSparkline({
  series,
  tone,
}: {
  series: HistorySeries | undefined;
  tone: RowTone;
}) {
  // Time is the X value, not the array index. With index spacing a three-hour
  // publisher outage would draw as one 30-second-wide step between adjacent
  // points — compressing a gap into a slope, which is precisely the "spiky vs
  // saturated" distinction the chart exists to preserve. A numeric axis over
  // real timestamps spaces the outage honestly (and gives the tooltip a real
  // clock time instead of an array index reinterpreted as an epoch).
  const points = useMemo(
    () =>
      (series?.points ?? []).map((p) => ({
        t: Date.parse(p.sampled_at),
        pressure: p.pressure,
      })),
    [series]
  );
  const usable = points.filter(
    (p) => p.pressure != null && Number.isFinite(p.t)
  ).length;

  if (usable < 2) {
    return (
      <span
        className="text-[11px] text-muted-foreground italic"
        data-testid="fleet-resource-sparkline-empty"
      >
        no history
      </span>
    );
  }

  return (
    <div data-testid="fleet-resource-sparkline" className="inline-block">
      <LineChart
        width={120}
        height={28}
        data={points}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <XAxis
          hide
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
        />
        <YAxis hide domain={[0, 1]} />
        <RechartsTooltip
          isAnimationActive={false}
          // Both params are typed `unknown` and narrowed at RUNTIME on
          // purpose. recharts types them loosely (`ValueType`, `ReactNode`),
          // so annotating them as `number | string` would be an assertion
          // about what the library passes rather than a check — and that is
          // precisely how the first version of this tooltip ended up
          // rendering an array index as a wall-clock time.
          formatter={(v: unknown) =>
            typeof v === "number" ? formatPercent(v) : "—"
          }
          labelFormatter={(l: unknown) =>
            typeof l === "number" && Number.isFinite(l)
              ? new Date(l).toLocaleTimeString()
              : "—"
          }
          contentStyle={{
            backgroundColor: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            borderRadius: "6px",
            fontSize: "11px",
          }}
        />
        <Line
          type="monotone"
          dataKey="pressure"
          stroke={SPARK_STROKE[tone]}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

function LaneCell({ row }: { row: StripRow }) {
  if (!row.lane) {
    return <span className="text-muted-foreground italic">no lane</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant="outline" className="font-mono text-[10px]">
        {row.lane}
      </Badge>
      {row.laneInstance && (
        <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[14rem]">
          {row.laneInstance}
        </span>
      )}
    </span>
  );
}

/**
 * The lead column: the lane's pressure MAGNITUDE.
 *
 * Renders the server's ratio, the instrument that produced it, and — on
 * hover — the exact formula and the raw counters it came from. §C1 requires
 * the row to SAY which metric it is showing: a lead column that silently
 * means `swap_used/swap_total` on one row and `1 − commit_available/
 * commit_total` on the next is a new version of the confidently-wrong
 * dashboard.
 *
 * It is deliberately **not colour-toned**. "How loaded is it" and "will it
 * refuse work" are different questions, and the band that used to answer the
 * second from the first was a client-side constant coord never agreed to.
 * The Admission column beside this one carries the verdict and the tone.
 */
function PressureCell({ row }: { row: StripRow }) {
  const sample = row.sample;
  const pressure = sample?.pressure ?? null;

  if (row.freshness === "unknown") {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        data-testid="fleet-resource-pressure-unknown"
      >
        <span className="text-muted-foreground">unknown</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent className="max-w-[20rem] text-[11px]">
            {sample
              ? "This machine's last sample is too old to mean anything. Absence of signal is not health."
              : "This machine has published no resource sample. Absence of signal is not health — it is NOT healthy, and it is NOT idle."}
          </TooltipContent>
        </Tooltip>
      </span>
    );
  }

  // `hasPressureValue` rather than `!pressure`: a non-finite ratio is also
  // "no magnitude", and it would otherwise print as "NaN%".
  if (!hasPressureValue(row.freshness, pressure)) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        data-testid="fleet-resource-pressure-no-opinion"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground underline decoration-dotted">
              unknown
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[20rem] text-[11px]">
            The server has no pressure opinion for this lane — its divisor is
            absent or zero, or the lane is one coord does not rank. Rendered
            unknown rather than 0: a zero here would sort an unmeasured machine
            first.
          </TooltipContent>
        </Tooltip>
      </span>
    );
  }

  const stale = row.freshness === "stale";
  // §C1: a `host` row must never show a swap figure — not even one coord
  // handed us. `laneShowsSwap` is the guard, applied to the LANE rather than
  // to the server's `basis`, so a publisher (or coord) bug that stamps
  // `basis: "swap"` on a Windows host row still cannot print the commit
  // counters a second time under a swap label. The ratio itself is still the
  // server's; only the raw-counter disclosure is withheld.
  const swapSuppressed =
    pressure.basis === "swap" && !laneShowsSwap(row.lane ?? "");
  const raw = swapSuppressed
    ? "raw counters withheld: this is a host lane, where swap is derived from " +
      "the same commit counters (one instrument, not two)"
    : pressure.basis === "swap"
      ? `swap_used ${formatBytes(sample?.swap_used_bytes)} / swap_total ${formatBytes(
          sample?.swap_total_bytes
        )}`
      : `commit_available ${formatBytes(
          sample?.commit_available_bytes
        )} / commit_total ${formatBytes(sample?.commit_total_bytes)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1.5"
          data-testid="fleet-resource-pressure"
        >
          <span
            className={`font-medium tabular-nums ${
              stale ? "line-through opacity-60 text-muted-foreground" : ""
            }`}
          >
            {formatPercent(pressure.ratio)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {swapSuppressed ? "commit used" : pressureLabel(pressure.basis)}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[22rem] text-[11px] space-y-1">
        <div className="font-mono">{pressureFormula(pressure.basis)}</div>
        <div className="font-mono text-muted-foreground">{raw}</div>
        <div>
          Computed by coord, not by this page — the CI dispatcher ranks on the
          same value. It is a magnitude, not a verdict: whether this lane
          accepts work is the Admission column.
        </div>
        {stale && (
          <div className="text-yellow-600 dark:text-yellow-400">
            STALE: this is the last value, not the current one.
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The THIRD axis: how much of the lane's TASK CEILING is spent.
 *
 * Plan `2026-08-27-fleet-telemetry-has-no-saturation-dimension-but-memory`,
 * Phase 5. This column did not exist on 2026-08-27, which is why a machine at
 * 190,840 / 192,146 kernel tasks — 99.3%, no process in the VM able to
 * `fork()` — rendered green on every lane of this table. Every number the
 * table showed that day was accurate; every one was about memory.
 *
 * Like `PressureCell` it is a MAGNITUDE and is deliberately **not**
 * colour-toned: the tone belongs to the Admission column, which carries
 * coord's verdict. And like every other cell here it computes nothing — the
 * ratio is coord's `lane_saturation`, and the threshold it is graded against
 * lives in coord's `saturation_floor`, never here.
 *
 * **Unknown never renders green.** Four different absences (`classifySaturation`)
 * all render the same muted `unknown`; only the wording differs, because only
 * the wording tells an operator whether to rebuild a runner, chase a failing
 * probe, or upgrade coord. The whole fleet reads `unmeasured` here until each
 * machine's runner is next rebuilt, and that is CORRECT.
 */
function SaturationCell({ row }: { row: StripRow }) {
  const sample = row.sample;
  const report = classifySaturation(sample);
  const saturation = sample?.saturation ?? null;

  if (row.freshness === "unknown" || !hasSaturationValue(saturation)) {
    // A sample too old to trust outranks whatever the axis last said, for the
    // same reason every other cell on the row is withheld: coord computed it
    // against numbers that have stopped being true.
    const cause = row.freshness === "unknown" ? "stale-sample" : report;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1.5 text-muted-foreground underline decoration-dotted"
            data-testid="fleet-resource-saturation-unknown"
            data-saturation-report={cause}
          >
            unknown
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[22rem] text-[11px] space-y-1">
          <div>
            {row.freshness === "unknown"
              ? "This machine's newest sample is too old to mean anything, so the saturation axis is unknown along with everything else on the row."
              : SATURATION_REPORT_MEANING[report]}
          </div>
          <div className="text-muted-foreground">
            Absence of signal is not health. Unknown here is never green, and
            never zero — a zero would rank an unmeasured machine FIRST.
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  const stale = row.freshness === "stale";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1.5"
          data-testid="fleet-resource-saturation"
          data-saturation-report={report}
        >
          <span
            className={`font-medium tabular-nums ${
              stale ? "line-through opacity-60 text-muted-foreground" : ""
            }`}
          >
            {formatPercent(saturation.ratio)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {pressureLabel(saturation.basis)}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[22rem] text-[11px] space-y-1">
        <div className="font-mono">{pressureFormula(saturation.basis)}</div>
        <div
          className="font-mono text-muted-foreground"
          data-testid="fleet-resource-saturation-counts"
        >
          {formatSaturationCounts(sample)}
        </div>
        <div className="text-muted-foreground">
          {saturationSourceLabel(sample?.saturation_source)}
        </div>
        <div>
          Instrumentally independent of memory — which is the point. On
          2026-08-27 this axis read 99% on a machine whose every memory gauge
          read healthy. Computed by coord; whether the lane still accepts work
          is the Admission column.
        </div>
        {stale && (
          <div className="text-yellow-600 dark:text-yellow-400">
            STALE: this is the last value, not the current one.
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One reported floor: its value, whether a tenant policy set it or it is the
 * built-in default, and whether the lane **defers** or **rejects** there.
 *
 * `reject` vs `defer` is not decoration — one fails the work now, the other
 * makes it late — so the verdict is a badge rather than a tooltip, and the
 * two get different variants.
 *
 * A verdict or source this build does not recognize renders as an explicit
 * `unknown` carrying the raw string, NOT as the milder of the two arms:
 * `describeFloor` normalizes, and telling an operator that a hard-refusing
 * lane merely defers is the same false-safe this change removes elsewhere.
 */
function FloorLine({
  label,
  detail,
  reported,
  offAxisNote,
}: {
  label: string;
  /** `describeFloor` / `describePressureFloor` output — already normalized. */
  detail: FloorDetail | null;
  /**
   * Set when this threshold is measured on a quantity the ROW's pressure
   * column is not showing — the Windows `host` carve-out. Without it an
   * operator naturally compares "50% swap used" to a commit percentage
   * sitting three columns away, which is the two-instruments-read-as-one
   * error in the other direction.
   */
  offAxisNote?: string;
  /**
   * Three-way, because the two absences are different claims: `"absent"` is
   * an older coord that never mentioned this axis, `"null"` is coord saying
   * no threshold governs it. Only the second is a fact about the fleet.
   */
  reported: "present" | "null" | "absent";
}) {
  if (reported === "absent") {
    return (
      <span
        className="text-[10px] text-muted-foreground italic"
        data-testid="fleet-resource-floor-missing"
      >
        {label} threshold not reported
      </span>
    );
  }
  // ORDER MATTERS: an explicit null must be answered before the
  // undescribable-value fallback, or "coord says this axis has no guard"
  // would print as "coord told us nothing" — collapsing the two claims the
  // three-way split exists to keep apart.
  if (reported === "null") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-[10px] text-muted-foreground underline decoration-dotted"
            data-testid="fleet-resource-floor-none"
          >
            no {label} threshold
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          coord reports no guard on this axis for this lane. Not the same as
          unmeasured — and not the same as unguarded overall, since the other
          axis may still carry one.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (!detail) {
    // Reported, but this build cannot read the value (out of range, corrupt).
    // Distinct from both absences: something IS there and we cannot use it.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-[10px] text-muted-foreground italic underline decoration-dotted"
            data-testid="fleet-resource-floor-unreadable"
          >
            {label} threshold unreadable
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          coord reported a threshold on this axis whose value this build cannot
          interpret. Treat the lane as guarded by an unknown rule, not as
          unguarded.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1 text-[10px]"
      data-testid="fleet-resource-floor"
    >
      <span className="text-muted-foreground">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={
              detail.verdict === "reject"
                ? "destructive"
                : detail.verdict === "defer"
                  ? "secondary"
                  : "outline"
            }
            className="text-[9px] px-1 py-0"
          >
            {detail.verdictLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          {detail.verdict === "unset"
            ? "coord reports this threshold but nothing enforces it — a control that validates and versions with no consumer. It is a number somebody set, not a rule anything acts on."
            : detail.verdict === "unreported"
              ? "coord sent this threshold without saying what happens at it — an older coord. Treat the lane as guarded by an unknown rule, not as unguarded."
              : detail.verdict === "unrecognized"
                ? "This build does not recognize what coord says happens at this threshold — a newer coord. It may refuse work outright; do not read it as a delay."
                : FLOOR_VERDICT_HINT[detail.verdict]}
        </TooltipContent>
      </Tooltip>
      {/* The direction word is load-bearing: a byte floor is crossed going
          DOWN and a pressure ceiling going UP, so one preposition cannot
          serve both without inverting the meaning for the reader. Withheld
          only when NOTHING enforces this threshold — "below 4.0 GB" states a
          behaviour, and an unenforced number has none. */}
      {detail.enforced && (
        <span className="text-muted-foreground">{detail.direction}</span>
      )}
      <span className="tabular-nums">{detail.value}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-[9px] px-1 py-0">
            {detail.sourceLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          {detail.source === "policy"
            ? "Set for this tenant in the fleet runtime policy — an operator chose this number."
            : detail.source === "default"
              ? "coord's built-in default — no tenant policy overrides it."
              : "coord reported a provenance this build does not recognize. Whether anybody configured this number is unknown."}
        </TooltipContent>
      </Tooltip>
      <RejectClause detail={detail} />
      {offAxisNote && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="text-muted-foreground italic underline decoration-dotted"
              data-testid="fleet-resource-floor-off-axis"
            >
              ({offAxisNote})
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-[20rem] text-[11px]">
            This threshold is measured on a different quantity from the Pressure
            column on this row, so the two percentages are not comparable. The
            rule is coord&apos;s and is shown because it is enforced; the
            comparison an operator would naturally make is not valid here.
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

/** Which of the three states a wire field is in, without collapsing two. */
function reportedState(value: unknown): "present" | "null" | "absent" {
  if (value === undefined) return "absent";
  if (value === null) return "null";
  return "present";
}

/**
 * The SECOND enforcer on the same column — the one that refuses.
 *
 * A column can be guarded twice with deliberately different numbers (host
 * commit: supervisor defers at 5 GiB, `ci_node` rejects at 4 GiB), and the
 * rejecting threshold sits LOWER on purpose so the deferring guard trips
 * first. An operator who sees only one of the two cannot tell whether a
 * refusing machine is failing builds or merely delaying them — which is the
 * §C3 requirement this clause exists for.
 *
 * "coord says there is no rejecting enforcer" and "coord never mentioned one"
 * render differently: only the first is a fact about the fleet.
 */
function RejectClause({ detail }: { detail: FloorDetail }) {
  if (detail.reject.kind === "same") return null;
  if (detail.reject.kind === "not-reported") {
    return (
      <span
        className="text-muted-foreground italic"
        data-testid="fleet-resource-reject-floor-missing"
      >
        reject threshold not reported
      </span>
    );
  }
  if (detail.reject.kind === "unreadable") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-muted-foreground italic underline decoration-dotted"
            data-testid="fleet-resource-reject-floor-unreadable"
          >
            reject threshold unreadable
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          coord reported a rejecting threshold whose value this build cannot
          interpret. NOT the same as there being none — something may refuse
          work here at a level we cannot show.
        </TooltipContent>
      </Tooltip>
    );
  }
  if (detail.reject.kind === "none") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="text-muted-foreground underline decoration-dotted"
            data-testid="fleet-resource-reject-floor-none"
          >
            no reject threshold
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          coord reports no rejecting enforcer on this column — work here is
          delayed at the floor above, not refused. Not the same as a reject
          threshold of zero.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">·</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="text-[9px] px-1 py-0">
            rejects
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[20rem] text-[11px]">
          {FLOOR_VERDICT_HINT.reject}{" "}
          {!detail.rejectIsPastPrimary
            ? "It is NOT set past the threshold on the left, so this one is reached first — read the two numbers rather than assuming the usual order."
            : detail.verdict === "defer"
              ? "It is set past the deferring threshold on the left on purpose — lower on a byte floor, higher on a pressure ceiling — so the wait trips first and a recoverable delay does not become a failed build."
              : "It is set past the threshold on the left — lower on a byte floor, higher on a pressure ceiling."}
        </TooltipContent>
      </Tooltip>
      <span className="text-muted-foreground">{detail.direction}</span>
      <span className="tabular-nums">{detail.reject.value}</span>
      <Badge variant="outline" className="text-[9px] px-1 py-0">
        {detail.reject.sourceLabel}
      </Badge>
    </span>
  );
}

/**
 * The verdict column — **where this row's colour comes from**.
 *
 * `headroom` is coord's own admission state for the lane, computed against
 * the floor coord enforces, on the column that floor governs. The strip does
 * not re-derive it and holds no threshold of its own, so "the dashboard says
 * red" and "the dispatcher stopped sending work" cannot come apart.
 *
 * `unknown` — the field absent (a coord without the floor fields), null, or a
 * stale/absent sample — renders in the same muted tone as a dead row. Absence
 * of signal is not health.
 */
function AdmissionCell({ row, tone }: { row: StripRow; tone: RowTone }) {
  const headroom: Headroom =
    row.freshness === "fresh" ? rowHeadroom(row.sample) : "unknown";
  const report = headroomReport(row.sample);

  const pressureFloor = row.sample?.pressure_floor;
  // §C1 suppresses the SWAP figure on a lane that derives swap from the commit
  // counters. It suppresses the swap THRESHOLD line too — but only while there
  // is nothing to disclose. A basis that is not swap is not covered by that
  // rule at all. (`laneShowsSwap("")` is true, so a lane-less row would show
  // the line; such a row has no sample, so the floors are withheld anyway.)
  const pressureFigureHidden =
    !laneShowsSwap(row.lane ?? "") &&
    pressureAxisIsSwap(pressureFloor?.basis ?? "swap_ratio");
  const showsPressureAxis = !pressureFigureHidden || pressureFloor != null;

  return (
    <span
      className="inline-flex flex-col gap-0.5"
      data-testid="fleet-resource-admission"
      data-headroom={headroom}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
            <Badge variant={TONE_BADGE[tone]} className="text-[10px]">
              {HEADROOM_LABEL[headroom]}
            </Badge>
            {/* The verb, on screen rather than only in the colour: a breached
                lane FAILS the work and a warned one DELAYS it, and an
                operator deciding whether to drain a machine needs the
                difference without hovering. */}
            {headroom !== "unknown" && (
              <span
                className="text-[10px] text-muted-foreground"
                data-testid="fleet-resource-admission-verb"
              >
                {headroom === "breach"
                  ? "builds fail here"
                  : headroom === "warn"
                    ? "builds wait"
                    : "no guard acting"}
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[22rem] text-[11px] space-y-1">
          <div>
            coord&apos;s own admission verdict for this lane, computed against
            the floors below. This page holds no threshold of its own — if it
            says the machine is refusing work, the dispatcher already stopped
            sending it.
          </div>
          <div className="text-muted-foreground">
            {HEADROOM_MEANING[headroom]}
          </div>
          {headroom === "unknown" && (
            <div className="text-muted-foreground">
              {row.freshness !== "fresh"
                ? "The sample is not current, so the verdict computed from it is not either."
                : report === "recognized"
                  ? "coord reports this lane's admission state as unknown."
                  : report === "unrecognized"
                    ? "coord reported an admission state this build does not recognize — a coord newer than this page. Unrecognized is NOT healthy."
                    : "coord did not report an admission state for this lane — an older coord, or a lane it does not admit on. Unknown is NOT healthy."}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
      {/* A floor reported inside a sample too old to trust is a config value
          that may since have changed, so an `unknown` row withholds it for
          the same reason it withholds the measurements — and a `stale` row
          demotes it the same way every other cell on that row is demoted. */}
      {row.freshness !== "unknown" && (
        <>
          <Aged freshness={row.freshness}>
            <FloorLine
              label="mem"
              detail={describeFloor(row.sample?.floor)}
              reported={reportedState(row.sample?.floor)}
            />
          </Aged>
          <Aged freshness={row.freshness}>
            <FloorLine
              label="disk"
              detail={describeFloor(row.sample?.disk_floor)}
              reported={reportedState(row.sample?.disk_floor)}
            />
          </Aged>
          {/* The pressure axis. On the Linux lanes this is the ONLY guard —
              `ci_node` reads free commit and nothing floors mem_available —
              so omitting it would render a WSL row at swap 0.6 as "no guard
              acting" while the dispatcher had already stepped back.

              Suppressed on a lane that shows no swap figure UNLESS coord
              actually asserts a threshold there. §C1 forbids a swap word on
              a Windows host row because swap is the commit counters printed
              twice — and "no swap threshold" on a lane that has no swap axis
              is noise, not disclosure. A real reported ceiling still prints:
              withholding a rule the dispatcher enforces is the inversion this
              column exists to prevent, and it outranks the tidiness rule. */}
          {showsPressureAxis && (
            <Aged freshness={row.freshness}>
              <FloorLine
                // Derived from the basis, not assumed: a second
                // `PressureFloorBasis` would otherwise be mislabelled "swap"
                // AND wrongly gated on the swap-suppression rule.
                label={pressureAxisLabel(row.sample?.pressure_floor?.basis)}
                detail={describePressureFloor(row.sample?.pressure_floor)}
                reported={reportedState(row.sample?.pressure_floor)}
                offAxisNote={
                  pressureFigureHidden
                    ? "not this row's pressure axis"
                    : undefined
                }
              />
            </Aged>
          )}
          {/* The SATURATION axis — never gated on the swap-suppression rule,
              and never omitted for a lane. Coord reports this threshold on
              EVERY lane, because a task table is a task table on Windows and
              Linux alike and the incident that motivated the axis was a
              container exhausting the HOST's kernel.threads-max. Restricting
              it the way the swap ceiling is restricted would leave the arm
              that actually broke with no rule on screen.

              The number is coord's, read off the row. This page states it and
              does not own it — a 0.80 written here would be §C1's defect
              (ratio shared, threshold not) on the newest axis. */}
          <Aged freshness={row.freshness}>
            <FloorLine
              label={pressureAxisLabel(
                row.sample?.saturation_floor?.basis ?? "thread_ratio"
              )}
              detail={describePressureFloor(row.sample?.saturation_floor)}
              reported={reportedState(row.sample?.saturation_floor)}
            />
          </Aged>
        </>
      )}
    </span>
  );
}

/**
 * A cell whose value is only meaningful while the sample is current.
 *
 * §C3 applies to the WHOLE row, not just the lead column: a row badged
 * "unknown" that still prints `13 GB / 32 GB (41%)` beside it is telling the
 * operator two contradictory things, and the number is the more believable
 * one. `unknown` withholds the value entirely; `stale` shows it demoted, so
 * "last known" stays available without reading as current.
 */
function Aged({
  freshness,
  children,
}: {
  freshness: StripRow["freshness"];
  children: React.ReactNode;
}) {
  if (freshness === "unknown") {
    return <span className="text-muted-foreground">unknown</span>;
  }
  if (freshness === "stale") {
    return (
      <span className="text-muted-foreground opacity-60 italic">
        {children}
      </span>
    );
  }
  return <>{children}</>;
}

/** Free/total memory for the lane, plus the COUPLED figure on a WSL row. */
function MemoryCell({ row }: { row: StripRow }) {
  const s = row.sample;
  if (!s || row.freshness === "unknown") {
    return <span className="text-muted-foreground">unknown</span>;
  }

  const isWsl = s.lane === "wsl" || s.lane === "container";
  const coupled = isWsl ? coupledWslHeadroomBytes(s, row.hostSample) : null;
  const hostBinds = isWsl && hostIsBindingConstraint(s, row.hostSample);
  // The ceiling the coupled figure is spendable AGAINST — §C1 forbids a bare
  // byte count, and the host's own free-commit number lives on a DIFFERENT
  // row of this table, so "show both side by side" has to mean here.
  const coupledCeiling = hostBinds
    ? row.hostSample?.commit_total_bytes
    : s.mem_total_bytes;

  return (
    <Aged freshness={row.freshness}>
      <span className="inline-flex flex-col leading-tight">
        <span className="tabular-nums text-[11px]">
          {formatRatioOfCeiling(s.mem_available_bytes, s.mem_total_bytes)}
        </span>
        {isWsl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`text-[10px] ${
                  hostBinds
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-muted-foreground"
                }`}
                data-testid="fleet-resource-coupled-headroom"
              >
                {coupled == null
                  ? "coupled: unknown (no host lane sample)"
                  : `spendable: ${formatRatioOfCeiling(coupled, coupledCeiling)}${
                      hostBinds ? " of host commit (host-bound)" : ""
                    }`}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[22rem] text-[11px]">
              {
                "WSL returns idle pages to Windows, so `memory=` in .wslconfig is a CEILING, not a reservation. Real WSL headroom is min(WSL free, host free commit) — a WSL lane reading 9 GB free beside a host at 900 MB free commit is showing memory that cannot be spent."
              }
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    </Aged>
  );
}

function AgeCell({ row }: { row: StripRow }) {
  const s = row.sample;
  if (!s) {
    return (
      <Badge variant="outline" data-testid="fleet-resource-age">
        never
      </Badge>
    );
  }
  if (row.freshness === "fresh") {
    return (
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {formatAge(s.age_secs)}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={row.freshness === "unknown" ? "outline" : "destructive"}
          data-testid="fleet-resource-stale-badge"
        >
          {row.freshness === "unknown" ? "unknown" : "stale"} ·{" "}
          {formatAge(s.age_secs)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[20rem] text-[11px]">
        No sample within {STALE_AFTER_SECS}s (four times the runner&apos;s 30 s
        publish cadence). Everything on this row is a last-known value, not a
        current one.
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Floors legend — how to read the per-row floors, NOT what they are
// ---------------------------------------------------------------------------

/**
 * The legend explains the vocabulary. It states **no numbers**.
 *
 * Its predecessor listed the floors as constants transcribed from the
 * publishers' source, because nothing on the wire carried them. Coord now
 * reports the floor it is enforcing per row, so every number on this surface
 * comes from there — and a transcribed table beside a reported one is a
 * second source of truth waiting to drift.
 *
 * `missingFloors` is surfaced rather than hidden: rows with no reported floor
 * are the pre-deployment state, and saying "not reported" out loud is the
 * difference between a known gap and an invisible one.
 */
function FloorsLegend({
  missingFloors,
  warnMargin,
}: {
  missingFloors: number;
  warnMargin: number | undefined;
}) {
  return (
    <div
      className="rounded border border-dashed p-2 space-y-1"
      data-testid="fleet-resource-floors"
    >
      <div className="text-[11px] font-medium">
        Reading the Admission column — floors come from coord, not from this
        page
      </div>
      <ul className="space-y-0.5 text-[11px] text-muted-foreground">
        <li>
          <Badge variant="destructive" className="text-[9px] px-1 py-0 mr-1.5">
            rejects
          </Badge>
          {FLOOR_VERDICT_HINT.reject}
        </li>
        <li>
          <Badge variant="secondary" className="text-[9px] px-1 py-0 mr-1.5">
            defers
          </Badge>
          {FLOOR_VERDICT_HINT.defer}
        </li>
        <li>
          <Badge variant="outline" className="text-[9px] px-1 py-0 mr-1.5">
            policy
          </Badge>
          a number an operator set for this tenant;{" "}
          <Badge variant="outline" className="text-[9px] px-1 py-0 mx-1">
            default
          </Badge>
          coord&apos;s built-in fallback.
        </li>
        <li data-testid="fleet-resource-axes">
          Thresholds live on <strong>three</strong> axes, running in{" "}
          <em>opposite</em> directions: a <strong>byte floor</strong> (mem,
          disk) is crossed going <em>down</em>, while a{" "}
          <strong>ratio ceiling</strong> (swap, saturation) is crossed going{" "}
          <em>up</em>. A Windows <code>host</code> row carries byte floors and
          no swap ceiling; a Linux lane carries the swap ceiling and no memory
          floor, because nothing in the fleet floors <code>mem_available</code>.
          The <strong>saturation</strong> ceiling is on <em>every</em> lane — a
          task table is a task table on either platform, and the incident that
          added this axis was a container exhausting the host&apos;s kernel task
          ceiling. Both absent on one axis means genuinely unguarded there —
          which is not the same as unmeasured, and is why &quot;no
          threshold&quot; and &quot;not reported&quot; are worded differently.
        </li>
        <li data-testid="fleet-resource-saturation-legend">
          <strong>Saturation</strong> is the axis that is not about memory. It
          was added after 2026-08-27, when a machine at 190,840 of 192,146
          kernel tasks — unable to <code>fork()</code> at all — rendered green
          on every lane of this table because all three of its memory
          instruments read healthy. A lane reads <code>unknown</code> here until
          its machine&apos;s runner is rebuilt to publish the counts; during
          that window unknown is <em>correct</em>, and it is still not healthy.
        </li>
        <li data-testid="fleet-resource-warn-margin">
          On a <strong>byte floor</strong>, a lane reads{" "}
          <strong>work waits</strong> from{" "}
          <span className="tabular-nums">{formatWarnMargin(warnMargin)}</span>{" "}
          the deferring floor <em>downwards</em> — the margin is coord&apos;s,
          read off this response, never assumed here. On a{" "}
          <strong>pressure ceiling</strong> there is deliberately no early band:
          at or above the ceiling a guard is already acting, and an amber band
          below it would assert something no enforcer does.
        </li>
      </ul>
      <p className="text-[10px] text-muted-foreground">
        A column can be guarded <em>twice</em> with deliberately different
        numbers — the rejecting threshold sits <em>past</em> the deferring one,
        which means <strong>lower</strong> on a byte floor and{" "}
        <strong>higher</strong> on a pressure ceiling, so the wait trips first
        and a recoverable delay never becomes a failed build. Both are shown;
        neither is inferred. The row&apos;s colour is coord&apos;s{" "}
        <em>admission verdict</em> against these floors — not a band over the
        pressure ratio. This page keeps no threshold of its own, so a red row
        means the dispatcher has already stopped electing that lane. Memory and
        disk are kept apart because memory frees on its own and disk does not.
      </p>
      {missingFloors > 0 && (
        <p
          className="text-[10px] text-muted-foreground"
          data-testid="fleet-resource-floors-missing"
        >
          {missingFloors} lane{missingFloors === 1 ? "" : "s"} left a threshold
          unreported. That is a coord without these fields, not a lane without a
          limit — those rows read <strong>unknown</strong>, which is not
          healthy.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface FleetResourceStripProps {
  /**
   * Coord's device list (`GET /operations/fleet/health`), already polled by
   * the page. It is the SPINE of the table: a device with no sample must
   * still appear — as `unknown`, never absent and never healthy.
   */
  devices: FleetDeviceRef[];
  /**
   * The shared resource-sample poll. Passed in rather than opened here so the
   * strip and the CI panel read ONE poll of the same rows — the same reason
   * `DeviceStatusTile` takes its stream as a prop.
   */
  resources: UseFleetResourceSamplesResult;
}

export function FleetResourceStrip({
  devices,
  resources,
}: FleetResourceStripProps) {
  const { data, loading, error, fetchedAtMs, refresh } = resources;

  // Advance the clock independently of the poll. Without this the row ages
  // would only move when a poll SUCCEEDS — so an outage would freeze every
  // row at whatever it last said, which is the exact failure §C3 forbids.
  // 15 s is well under STALE_AFTER_SECS, so the transition can't be missed.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const sinceFetchSecs =
    fetchedAtMs == null ? 0 : Math.max(0, (nowMs - fetchedAtMs) / 1000);

  const latest: ResourceSampleRow[] = useMemo(
    () => data?.latest ?? [],
    [data?.latest]
  );
  const groups = useMemo(
    () => buildMachineGroups(devices, latest, sinceFetchSecs),
    [devices, latest, sinceFetchSecs]
  );
  const historyByAnchor = useMemo(() => {
    const m = new Map<string, HistorySeries>();
    for (const s of data?.history ?? []) {
      m.set(rowAnchor(s), s);
    }
    return m;
  }, [data?.history]);

  const { unknownLanes, staleLanes, breachLanes, warnLanes, missingFloors } =
    useMemo(() => {
      let unknown = 0;
      let stale = 0;
      let breach = 0;
      let warn = 0;
      let missing = 0;
      for (const g of groups) {
        for (const r of g.rows) {
          if (r.freshness === "unknown") unknown += 1;
          else if (r.freshness === "stale") stale += 1;
          else {
            const h = rowHeadroom(r.sample);
            if (h === "breach") breach += 1;
            else if (h === "warn") warn += 1;
          }
          // Only a row whose floors are actually rendered can be missing
          // one; a machine that published nothing (or too long ago) is
          // already counted as unknown above. BOTH floors count: a coord
          // reporting the memory floor but not the disk one would otherwise
          // print "disk floor not reported" while the legend claimed no gaps.
          if (
            r.freshness !== "unknown" &&
            r.sample != null &&
            (r.sample.floor === undefined ||
              r.sample.disk_floor === undefined ||
              // Coord reports the SATURATION ceiling on every lane, so its
              // absence is always a coord that predates the axis — never a
              // lane that legitimately has no such rule. Unconditional for
              // exactly that reason, unlike the swap line below.
              r.sample.saturation_floor === undefined ||
              // Only on a lane that HAS a pressure axis — a Windows host row
              // saying nothing about swap is correct, not a reporting gap.
              // Same predicate the render uses, so the two cannot disagree.
              (laneShowsSwap(r.lane ?? "") &&
                r.sample.pressure_floor === undefined))
          ) {
            missing += 1;
          }
        }
      }
      return {
        unknownLanes: unknown,
        staleLanes: stale,
        breachLanes: breach,
        warnLanes: warn,
        missingFloors: missing,
      };
    }, [groups]);

  return (
    // Self-provided rather than assuming an ancestor: the app layout supplies
    // one, but a panel that throws "must be used within TooltipProvider" when
    // rendered anywhere else is a panel that cannot be tested in isolation.
    // Nested providers are a no-op.
    <TooltipProvider delayDuration={100}>
      <CollapsiblePanel
        data-testid="fleet-resource-strip"
        storageKey="fleet:resources"
        icon={<Gauge className="h-4 w-4" />}
        title="Machine resources"
        contentClassName="space-y-3"
        summary={
          <>
            <Badge variant="outline" className="ml-2">
              {groups.length} machines
            </Badge>
            {breachLanes > 0 && (
              <Badge
                variant="destructive"
                className="ml-1"
                data-testid="fleet-resource-breach-badge"
              >
                {breachLanes} refusing work
              </Badge>
            )}
            {warnLanes > 0 && (
              <Badge
                variant="secondary"
                className="ml-1"
                data-testid="fleet-resource-near-floor-badge"
              >
                {warnLanes} delaying work
              </Badge>
            )}
            {staleLanes > 0 && (
              <Badge variant="destructive" className="ml-1">
                {staleLanes} stale
              </Badge>
            )}
            {unknownLanes > 0 && (
              <Badge variant="outline" className="ml-1">
                {unknownLanes} unknown
              </Badge>
            )}
          </>
        }
        headerActions={
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            data-testid="fleet-resource-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        }
      >
        {error && (
          <p
            className="text-sm text-destructive"
            data-testid="fleet-resource-error"
          >
            Resource samples unavailable: {error}. Rows below are last-known,
            not current.
          </p>
        )}
        {data?.schema_pending && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="fleet-resource-schema-pending"
          >
            coord reports <code>schema_pending</code> — the
            <code> coord.device_resource_samples</code> migration has not
            reached its database yet, so no machine can have published a sample.
            Every lane below is <strong>unknown</strong>, which is not the same
            as healthy.
          </p>
        )}
        {data?.history_truncated && (
          <p className="text-[11px] text-muted-foreground">
            History was truncated at the server&apos;s row cap — some sparklines
            are short. That is a clipped chart, not a publisher that stopped.
          </p>
        )}

        {loading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No devices registered for this tenant.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Machine</th>
                  <th className="py-1 pr-3 font-medium">Lane</th>
                  <th className="py-1 pr-3 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="underline decoration-dotted">
                          Pressure
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[22rem] text-[11px]">
                        The lane&apos;s saturation, computed by coord — swap on
                        Linux lanes, free commit on the Windows host lane. Each
                        row says which. Never <code>mem_available</code>: it is
                        pinned under saturation and reads as an all-clear.
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="underline decoration-dotted"
                          data-testid="fleet-resource-saturation-header"
                        >
                          Saturation
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[22rem] text-[11px]">
                        How much of the lane&apos;s{" "}
                        <strong>task ceiling</strong> is spent —{" "}
                        <code>threads_used / threads_max</code>, or the{" "}
                        <code>pids_*</code> pair where a cgroup or job object
                        binds lower. Computed by coord, like Pressure.
                        <br />
                        This column is{" "}
                        <em>instrumentally independent of memory</em>, which is
                        why it exists: on 2026-08-27 a machine sat at 99.3% here
                        — no process in its VM could <code>fork()</code> — while
                        73.3 GB of commit was free and every lane of this table
                        was green.
                        <br />
                        <code>unknown</code> until a machine&apos;s runner is
                        rebuilt to publish the counts. Unknown is not healthy.
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-1 pr-3 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="underline decoration-dotted">
                          Admission
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[22rem] text-[11px]">
                        Whether coord will still send this lane work, and the
                        floors it decides that against. <strong>This</strong> is
                        what colours the row — not the Pressure ratio and not
                        the Saturation ratio, which are magnitudes. Coord takes
                        the <em>worst of three axes</em>: the memory/disk byte
                        floors, the swap ceiling, and the task-saturation
                        ceiling. Each is graded against the floor its own
                        enforcer reads, and this page keeps none of those
                        numbers.
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-1 pr-3 font-medium">Trend</th>
                  <th className="py-1 pr-3 font-medium">Disk</th>
                  <th className="py-1 pr-3 font-medium">Build slots</th>
                  <th className="py-1 pr-3 font-medium">CI jobs</th>
                  <th className="py-1 pr-3 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="underline decoration-dotted">
                          Threads / sessions
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[22rem] text-[11px]">
                        The publishing <strong>process&apos;s</strong> OS thread
                        count, and the terminal sessions live on it — a
                        different axis from every other column here, and the
                        only one that is instrumentally independent of memory.
                        On 2026-08-29 the primary runner wedged at 540 threads
                        against tokio&apos;s 512-slot blocking pool while
                        memory, commit and disk all read healthy and accurate.
                        Threads is the signal; sessions only explain it — the
                        same count can be ordinary work or a leak, and only the
                        pair says which. An em dash means <em>not reported</em>,
                        never zero: a live process cannot have zero threads, so
                        a zero here would read as maximally idle on the one
                        column built to catch a saturated one.
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-1 pr-3 font-medium">Memory (per lane)</th>
                  <th className="py-1 pr-3 font-medium">Sample</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) =>
                  group.rows.map((row, i) => {
                    const s = row.sample;
                    // The row's tone is the SERVER's admission verdict. There
                    // is no client-side band left to derive it from, and that
                    // is the point: the strip cannot show amber for a machine
                    // coord has already stopped electing.
                    const headroom = rowHeadroom(s);
                    const tone = headroomTone(row.freshness, headroom);
                    const diskRatio = safeRatio(
                      s?.disk_free_bytes,
                      s?.disk_total_bytes
                    );
                    return (
                      <tr
                        key={row.key}
                        data-testid="fleet-resource-row"
                        data-lane={row.lane ?? ""}
                        data-freshness={row.freshness}
                        data-headroom={
                          row.freshness === "fresh" ? headroom : "unknown"
                        }
                        data-tone={tone}
                        className={`border-t align-top ${TONE_ROW[tone]}`}
                      >
                        <td className="py-1.5 pr-3">
                          {i === 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-mono text-xs">
                                {group.displayName}
                              </span>
                              {/* NOT hardcoded `destructive` any more. Coord
                                  now serves a fifth `DeviceState`, `stale` —
                                  a device that is heartbeating fine but whose
                                  SAMPLER has gone quiet — and painting that
                                  the same red as `partitioned` ("coord cannot
                                  reach it at all") would tell an operator a
                                  live machine had dropped off the network.
                                  `deviceStateBadgeVariant` is the one mapping
                                  the console renders coord states through. */}
                              {group.state && group.state !== "healthy" && (
                                <Badge
                                  variant={deviceStateBadgeVariant(group.state)}
                                  data-coord-state={group.state}
                                >
                                  {group.state}
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <span className="sr-only">{group.displayName}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <LaneCell row={row} />
                        </td>
                        <td className="py-1.5 pr-3">
                          <PressureCell row={row} />
                        </td>
                        <td className="py-1.5 pr-3">
                          <SaturationCell row={row} />
                        </td>
                        <td className="py-1.5 pr-3">
                          <AdmissionCell row={row} tone={tone} />
                        </td>
                        <td className="py-1.5 pr-3">
                          {row.freshness === "unknown" ? (
                            <span className="text-[11px] text-muted-foreground italic">
                              —
                            </span>
                          ) : (
                            <PressureSparkline
                              series={historyByAnchor.get(row.key)}
                              tone={tone}
                            />
                          )}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                          {s ? (
                            <Aged freshness={row.freshness}>
                              <span
                                className={
                                  // Only a CURRENT sample earns the red tint —
                                  // an expired one going red would raise an
                                  // alarm about a disk state nobody has
                                  // observed in hours.
                                  row.freshness === "fresh" &&
                                  diskRatio != null &&
                                  diskRatio < 0.1
                                    ? "text-red-600 dark:text-red-400"
                                    : ""
                                }
                              >
                                {formatRatioOfCeiling(
                                  s.disk_free_bytes,
                                  s.disk_total_bytes
                                )}
                                {s.disk_mount && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    {s.disk_mount}
                                  </span>
                                )}
                              </span>
                            </Aged>
                          ) : (
                            <span className="text-muted-foreground">
                              unknown
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                          {s && s.build_slots_total != null ? (
                            <Aged freshness={row.freshness}>
                              {s.build_slots_busy ?? "?"}/{s.build_slots_total}
                              {s.build_queue_depth != null &&
                                s.build_queue_depth > 0 && (
                                  <span className="text-muted-foreground">
                                    {" "}
                                    +{s.build_queue_depth} queued
                                  </span>
                                )}
                            </Aged>
                          ) : (
                            <span className="text-muted-foreground">
                              not reported
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                          {s && s.ci_jobs_running != null ? (
                            <Aged freshness={row.freshness}>
                              {s.ci_jobs_running}
                            </Aged>
                          ) : (
                            <span className="text-muted-foreground">
                              not reported
                            </span>
                          )}
                        </td>
                        {/*
                          Threads / sessions. Rendered as two plain integers
                          rather than a ratio, because neither has a ceiling
                          ON THIS ROW to divide by: the blocking pool's 512 is
                          a runtime default the process can be configured away
                          from, and there is no session cap in the sample at
                          all. Printing `540/512` would assert a ceiling this
                          row never measured — the same mistake the module
                          header forbids for memory, in the other direction.

                          `??` and not `||`: a real 0 must print as 0, and
                          only null/undefined becomes the dash. That matters
                          most for the sessions half, where 0 is a legitimate
                          reading (an idle runner) and the thread count beside
                          it is what says whether idle is true.
                        */}
                        <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                          {s ? (
                            <Aged freshness={row.freshness}>
                              {s.thread_count ?? (
                                <span className="text-muted-foreground">—</span>
                              )}
                              <span className="text-muted-foreground">
                                {" / "}
                              </span>
                              {s.active_terminal_sessions ?? (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </Aged>
                          ) : (
                            <span className="text-muted-foreground">
                              unknown
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          <MemoryCell row={row} />
                        </td>
                        <td className="py-1.5 pr-3">
                          <AgeCell row={row} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <FloorsLegend
          missingFloors={missingFloors}
          warnMargin={data?.headroom_warn_margin}
        />

        <p className="text-[10px] text-muted-foreground flex items-start gap-1">
          <Activity className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Lanes are never summed. Host and WSL measure different pools, and
            because WSL hands idle pages back to Windows the two are coupled, so
            WSL headroom is only spendable up to the host&apos;s free commit.
          </span>
        </p>
      </CollapsiblePanel>
    </TooltipProvider>
  );
}
