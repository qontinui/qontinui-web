"use client";

/**
 * Shared pieces of the two computer pages. Every one composes console
 * primitives (`StatusBadge`, `StatCluster`, `RecordDetail`) and the Dev Ops
 * strip's own `PressureSparkline`; nothing here mints a colour or a shape
 * (style guide §6.4). The one pattern the guide did not already show — a
 * capacity-vs-usage lane table whose every cell can say `unknown` /
 * `not supported` and whose stale figures are labelled "last known" — is
 * recorded in the guide's §3.5.
 */

import type { ReactNode } from "react";
import { StatCluster, StatusBadge } from "@/components/console";
import { PressureSparkline } from "@/components/operations/PressureSparkline";
import {
  formatAge,
  formatPercent,
  type RowTone,
} from "@/components/operations/fleetResources";
import {
  FRESHNESS_PALETTE,
  freshnessStatus,
  historyPoints,
  laneDiskUsed,
  laneFreshness,
  laneKey,
  laneMemoryUsed,
  lanePressureRatio,
  readIssueText,
  readLaneField,
  readingText,
  usageText,
  type ComputerLaneWire,
  type ComputersReadIssue,
  type FreshnessReading,
  type LaneHistoryWire,
  type NormalizedComputer,
} from "../_lib/computerStatus";
import { formatBytes } from "@/components/operations/fleetResources";

/** The freshness badge: `fresh`, or an explicit STALE / UNKNOWN with the reason in its title. */
export function FreshnessBadge({
  reading,
  testId = "coord-computer-freshness",
}: {
  reading: FreshnessReading;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-ui-bridge-id={testId}
      data-freshness={reading.kind}
      className="inline-flex"
    >
      <StatusBadge
        status={freshnessStatus(reading)}
        palette={FRESHNESS_PALETTE}
      />
    </span>
  );
}

/**
 * The UNKNOWN banner for a read coord did not answer usefully. Deliberately
 * not an error page and not an empty list: a 404 from a coord that predates
 * the route, or `schema_pending`, is the absence of a measurement.
 */
export function ReadIssueBanner({
  issue,
  retained,
  testId,
}: {
  issue: ComputersReadIssue;
  /** An earlier read's body is still on screen — say so, it is now stale. */
  retained: boolean;
  testId: string;
}) {
  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
      data-testid={testId}
      data-ui-bridge-id={testId}
      data-issue={issue.kind}
    >
      <span className="font-semibold">
        {issue.kind === "not_found"
          ? "Not found — "
          : issue.kind === "forbidden"
            ? "Admins only — "
            : issue.kind === "tenant_not_resolved"
              ? "No project — "
              : "UNKNOWN — "}
      </span>
      {readIssueText(issue)}
      {retained && (
        <span className="block text-xs text-muted-foreground mt-1">
          The figures below are from the last good read and are not current.
        </span>
      )}
    </div>
  );
}

/** Capacity as a stat cluster. A capacity coord never received reads `unknown`, never `0`. */
export function CapacityStats({
  computer,
  testId = "coord-computer-capacity",
}: {
  computer: NormalizedComputer;
  testId?: string;
}) {
  const cap = computer.capacity;
  const gpuCount = Array.isArray(cap.gpus) ? cap.gpus.length : null;
  return (
    <StatCluster
      data-testid={testId}
      stats={[
        {
          key: "cores",
          label: "cores",
          value: cap.cpuCores ?? "unknown",
          tone: cap.cpuCores === null ? "muted" : "default",
        },
        {
          key: "memory",
          label: "memory",
          value:
            cap.memoryTotalBytes === null
              ? "unknown"
              : formatBytes(cap.memoryTotalBytes),
          tone: cap.memoryTotalBytes === null ? "muted" : "default",
        },
        {
          key: "swap",
          label: "swap",
          value:
            cap.swapTotalBytes === null
              ? "unknown"
              : formatBytes(cap.swapTotalBytes),
          tone: cap.swapTotalBytes === null ? "muted" : "default",
        },
        {
          key: "disk",
          label: "disk",
          value:
            cap.diskTotalBytes === null
              ? "unknown"
              : formatBytes(cap.diskTotalBytes),
          tone: cap.diskTotalBytes === null ? "muted" : "default",
        },
        {
          key: "gpus",
          label: "gpus",
          // `null` gpus is "not reported", which is not "none".
          value: gpuCount ?? "unknown",
          tone: gpuCount === null ? "muted" : "default",
        },
      ]}
    />
  );
}

const HEADROOM_TONE: Record<string, RowTone> = {
  ok: "ok",
  warn: "warn",
  breach: "critical",
};

function Cell({
  children,
  muted,
  testId,
  title,
}: {
  children: ReactNode;
  muted?: boolean;
  testId?: string;
  title?: string;
}) {
  return (
    <td
      className={`py-1.5 pr-3 tabular-nums text-[11px] whitespace-nowrap ${muted ? "text-muted-foreground italic" : ""}`}
      data-testid={testId}
      title={title}
    >
      {children}
    </td>
  );
}

function fieldCell(
  lane: ComputerLaneWire,
  field: keyof ComputerLaneWire,
  format: (v: number) => string,
  testId: string
) {
  const r = readLaneField(lane, field);
  return (
    <Cell
      muted={r.kind !== "value"}
      testId={testId}
      title={`${String(field)}: ${r.kind}`}
    >
      {readingText(r, format)}
    </Cell>
  );
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const load = (v: number) => v.toFixed(2);

/**
 * Capacity vs usage per lane. One row per `(lane, lane_instance)`.
 *
 * **A stale lane's figures are not shown as current**: the row is dimmed
 * (`opacity-60`), its freshness badge in the "sample" column says STALE (or
 * UNKNOWN), and a "last known, <age>" note sits beside that badge — so
 * nothing on a stale row reads as "now".
 */
export function LaneTable({
  computer,
  computerFreshness,
  history,
  fetchedAtMs,
  nowMs,
  showSparkline,
}: {
  computer: NormalizedComputer;
  computerFreshness: FreshnessReading;
  history?: Map<string, LaneHistoryWire>;
  fetchedAtMs: number | null;
  nowMs: number;
  showSparkline: boolean;
}) {
  if (computer.lanes.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="coord-computer-lanes-unknown"
      >
        No resource sample from this computer — usage is unknown, not idle.
      </p>
    );
  }
  const cores = computer.capacity.cpuCores;
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-xs"
        data-testid="coord-computer-lanes"
        data-ui-bridge-id="coord-computer-lanes"
      >
        <thead className="text-muted-foreground">
          <tr>
            <th className="font-normal pb-1 pr-3">lane</th>
            <th className="font-normal pb-1 pr-3">sample</th>
            <th className="font-normal pb-1 pr-3">pressure</th>
            {showSparkline && (
              <th className="font-normal pb-1 pr-3">pressure (history)</th>
            )}
            <th className="font-normal pb-1 pr-3">memory used / total</th>
            <th className="font-normal pb-1 pr-3">swap used / total</th>
            <th className="font-normal pb-1 pr-3">disk used / total</th>
            <th
              className="font-normal pb-1 pr-3"
              title={`load average against ${cores ?? "unknown"} cores`}
            >
              load 1/5/15m{cores !== null ? ` (of ${cores})` : ""}
            </th>
            <th
              className="font-normal pb-1 pr-3"
              title="PSI some avg60: share of time at least one task stalled"
            >
              PSI mem / cpu / io (60s)
            </th>
            <th className="font-normal pb-1">OOM kills</th>
          </tr>
        </thead>
        <tbody>
          {computer.lanes.map((lane) => {
            const key = laneKey(lane);
            const fr = laneFreshness(
              lane,
              computerFreshness,
              fetchedAtMs,
              nowMs
            );
            const stale = fr.kind !== "fresh";
            const ratio = lanePressureRatio(lane);
            const tone: RowTone = stale
              ? "unknown"
              : (HEADROOM_TONE[lane.headroom ?? ""] ?? "unknown");
            return (
              <tr
                key={key}
                className={`border-t border-border/60 ${stale ? "opacity-60" : ""}`}
                data-testid="coord-computer-lane-row"
                data-lane={lane.lane ?? "unknown"}
                data-freshness={fr.kind}
              >
                <td className="py-1.5 pr-3 font-mono text-[11px]">
                  {lane.lane ?? "unknown lane"}
                  {lane.lane_instance ? ` · ${lane.lane_instance}` : ""}
                </td>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1">
                    <FreshnessBadge
                      reading={fr}
                      testId="coord-computer-lane-freshness"
                    />
                    {stale && (
                      <span
                        className="text-[10px] text-muted-foreground"
                        data-testid="coord-computer-lane-last-known"
                      >
                        last known
                        {fr.ageSecs !== null
                          ? `, ${formatAge(fr.ageSecs)}`
                          : ""}
                      </span>
                    )}
                  </span>
                </td>
                <Cell
                  muted={ratio === null}
                  testId="coord-computer-lane-pressure"
                  title={`headroom: ${lane.headroom ?? "unknown"}`}
                >
                  {ratio === null ? "unknown" : formatPercent(ratio)}
                  {lane.headroom && ratio !== null ? ` · ${lane.headroom}` : ""}
                </Cell>
                {showSparkline && (
                  <td className="py-1.5 pr-3">
                    <PressureSparkline
                      points={historyPoints(history?.get(key))}
                      tone={tone}
                      data-testid="coord-computer-lane-sparkline"
                      emptyTestId="coord-computer-lane-sparkline-empty"
                    />
                  </td>
                )}
                <Cell
                  testId="coord-computer-lane-memory"
                  muted={laneMemoryUsed(lane) === null}
                >
                  {usageText(
                    laneMemoryUsed(lane),
                    lane.mem_total_bytes ?? null
                  )}
                </Cell>
                <Cell
                  testId="coord-computer-lane-swap"
                  muted={lane.swap_used_bytes == null}
                >
                  {/* The lane's OWN swap total only: the computer's capacity figure
                      is a different box's (a WSL guest's swap is not the
                      host's), so dividing by it would fabricate a ratio. */}
                  {usageText(
                    lane.swap_used_bytes ?? null,
                    lane.swap_total_bytes ?? null
                  )}
                </Cell>
                <Cell
                  testId="coord-computer-lane-disk"
                  muted={laneDiskUsed(lane) === null}
                >
                  {usageText(laneDiskUsed(lane), lane.disk_total_bytes ?? null)}
                </Cell>
                <Cell testId="coord-computer-lane-load">
                  {readingText(readLaneField(lane, "load_1m"), load)} /{" "}
                  {readingText(readLaneField(lane, "load_5m"), load)} /{" "}
                  {readingText(readLaneField(lane, "load_15m"), load)}
                </Cell>
                <Cell testId="coord-computer-lane-psi">
                  {readingText(
                    readLaneField(lane, "psi_memory_some_avg60"),
                    pct
                  )}{" "}
                  /{" "}
                  {readingText(readLaneField(lane, "psi_cpu_some_avg60"), pct)}{" "}
                  / {readingText(readLaneField(lane, "psi_io_some_avg60"), pct)}
                </Cell>
                {fieldCell(
                  lane,
                  "oom_kill_total",
                  (v) => String(v),
                  "coord-computer-lane-oom"
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
