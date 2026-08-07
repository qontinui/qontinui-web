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
 * - **No swap figure appears on a `host` row at all.** Windows derives swap
 *   algebraically from the same commit counters, so printing both would read
 *   as corroboration from two instruments when it is one printed twice. The
 *   lead column IS the swap-or-commit figure; there is no second one.
 * - A `wsl` lane's headroom is never shown as spendable on its own:
 *   `pageReporting=true` couples the lanes, so the coupled
 *   `min(wsl_free, host_free_commit)` is shown beside the raw figure.
 * - Every figure is a **ratio against its own ceiling**; bare byte counts only
 *   ever appear next to the ratio that gives them meaning.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
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
import { CollapsiblePanel } from "./CollapsiblePanel";
import {
  buildMachineGroups,
  coupledWslHeadroomBytes,
  floorsForLane,
  formatAge,
  formatBytes,
  formatPercent,
  formatRatioOfCeiling,
  FLOOR_VERDICT_HINT,
  hostIsBindingConstraint,
  LANE_FLOORS,
  laneShowsSwap,
  pressureFormula,
  pressureLabel,
  pressureTone,
  rowAnchor,
  safeRatio,
  SATURATED_AT,
  STALE_AFTER_SECS,
} from "./fleetResources";
import type {
  FleetDeviceRef,
  HistorySeries,
  PressureTone,
  ResourceSampleRow,
  StripRow,
} from "./fleetResources";
import type { UseFleetResourceSamplesResult } from "./useFleetResourceSamples";

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

const TONE_DOT: Record<PressureTone, string> = {
  ok: "bg-green-500",
  warn: "bg-yellow-500",
  critical: "bg-red-500",
  unknown: "bg-muted-foreground/50",
};

const TONE_TEXT: Record<PressureTone, string> = {
  ok: "text-green-600 dark:text-green-400",
  warn: "text-yellow-600 dark:text-yellow-400",
  critical: "text-red-600 dark:text-red-400",
  unknown: "text-muted-foreground",
};

const SPARK_STROKE: Record<PressureTone, string> = {
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
 * The Y domain is **pinned to [0, 1]** and a reference line sits at the
 * critical band. Auto-scaling would draw a machine flat at 5% and a machine
 * flat at 95% as the same picture — and "spiky vs saturated" is exactly the
 * distinction that decides whether to drain a machine.
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
  tone: PressureTone;
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
        <ReferenceLine
          y={SATURATED_AT}
          stroke="#ef4444"
          strokeDasharray="2 2"
        />
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
 * The lead column.
 *
 * Renders the server's ratio, the instrument that produced it, and — on
 * hover — the exact formula and the raw counters it came from. §C1 requires
 * the row to SAY which metric it is showing: a lead column that silently
 * means `swap_used/swap_total` on one row and `1 − commit_available/
 * commit_total` on the next is a new version of the confidently-wrong
 * dashboard.
 */
function PressureCell({ row }: { row: StripRow }) {
  const sample = row.sample;
  const tone = pressureTone(row.freshness, sample?.pressure ?? null);
  const pressure = sample?.pressure ?? null;

  if (row.freshness === "unknown") {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        data-testid="fleet-resource-pressure-unknown"
      >
        <span className={`h-2 w-2 rounded-full ${TONE_DOT.unknown}`} />
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

  if (!pressure) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        data-testid="fleet-resource-pressure-no-opinion"
      >
        <span className={`h-2 w-2 rounded-full ${TONE_DOT.unknown}`} />
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
          <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
          <span
            className={`font-medium tabular-nums ${TONE_TEXT[tone]} ${
              stale ? "line-through opacity-60" : ""
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
          same value.
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
                ".wslconfig sets pageReporting=true, so WSL returns idle pages to Windows and its `memory=` setting is a CEILING, not a reservation. Real WSL headroom is min(WSL free, host free commit) — a WSL lane reading 9 GB free beside a host at 900 MB free commit is showing memory that cannot be spent."
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
// Floors legend — §C3's last requirement
// ---------------------------------------------------------------------------

const VERDICT_BADGE: Record<string, "destructive" | "secondary" | "outline"> = {
  rejects: "destructive",
  defers: "secondary",
  warns: "outline",
};

function FloorsLegend({ lanes }: { lanes: string[] }) {
  const floors = useMemo(() => {
    const seen = new Set<string>();
    const out = [] as typeof LANE_FLOORS;
    for (const lane of lanes) {
      for (const f of floorsForLane(lane)) {
        const k = `${f.guard}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(f);
        }
      }
    }
    return out.length > 0 ? out : LANE_FLOORS;
  }, [lanes]);

  return (
    <div
      className="rounded border border-dashed p-2 space-y-1"
      data-testid="fleet-resource-floors"
    >
      <div className="text-[11px] font-medium">
        Effective floors — and whether the lane defers or rejects
      </div>
      <ul className="space-y-0.5">
        {floors.map((f) => (
          <li
            key={f.guard}
            className="flex flex-wrap items-center gap-1.5 text-[11px]"
          >
            <Badge variant="outline" className="font-mono text-[10px]">
              {f.lane}
            </Badge>
            <span className="font-medium">{f.guard}</span>
            <span className="tabular-nums">{f.threshold}</span>
            <span className="text-muted-foreground">of {f.quantity}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={VERDICT_BADGE[f.verdict] ?? "outline"}>
                  {f.verdict}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="text-[11px]">
                {FLOOR_VERDICT_HINT[f.verdict]} — {f.source}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        Documented constants read out of the publishers&apos; source, not live
        per-device state — nothing on the wire carries them yet. Note the
        divergence rather than a tidy single number: the ci_node lane guards a
        different quantity (sysinfo available memory) at a different threshold
        and <em>rejects</em> where the supervisor <em>defers</em>.
      </p>
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

  const lanes = useMemo(
    () => Array.from(new Set(latest.map((r) => r.lane))),
    [latest]
  );

  const { unknownLanes, staleLanes } = useMemo(() => {
    let unknown = 0;
    let stale = 0;
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.freshness === "unknown") unknown += 1;
        else if (r.freshness === "stale") stale += 1;
      }
    }
    return { unknownLanes: unknown, staleLanes: stale };
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
                  <th className="py-1 pr-3 font-medium">Trend</th>
                  <th className="py-1 pr-3 font-medium">Disk</th>
                  <th className="py-1 pr-3 font-medium">Build slots</th>
                  <th className="py-1 pr-3 font-medium">CI jobs</th>
                  <th className="py-1 pr-3 font-medium">Memory (per lane)</th>
                  <th className="py-1 pr-3 font-medium">Sample</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) =>
                  group.rows.map((row, i) => {
                    const s = row.sample;
                    const tone = pressureTone(
                      row.freshness,
                      s?.pressure ?? null
                    );
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
                        className="border-t align-top"
                      >
                        <td className="py-1.5 pr-3">
                          {i === 0 ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-mono text-xs">
                                {group.displayName}
                              </span>
                              {group.state && group.state !== "healthy" && (
                                <Badge variant="destructive">
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

        <FloorsLegend lanes={lanes} />

        <p className="text-[10px] text-muted-foreground flex items-start gap-1">
          <Activity className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Lanes are never summed. Host and WSL measure different pools, and
            because <code>pageReporting=true</code> couples them, WSL headroom
            is only spendable up to the host&apos;s free commit.
          </span>
        </p>
      </CollapsiblePanel>
    </TooltipProvider>
  );
}
