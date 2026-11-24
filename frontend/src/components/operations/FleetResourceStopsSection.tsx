"use client";

/**
 * The "Pressure stops" table on `/admin/coord/devops` (plan
 * `2026-11-24-pressure-stops-record-box-stats-in-coord` Phase 4).
 *
 * One row per time a runner's resource guard refused or deferred work for low
 * free memory or a high thread count, with what the box was carrying when it
 * said no: session counts, active CI runners and the calibration in force.
 * "Stopped" means an admission refusal or deferral before a child existed — the
 * runner has no site that kills a running process for pressure — and kernel or
 * cgroup OOM kills are NOT here (coord records those as `oom_kill` computer
 * events).
 *
 * ## The honesty rules this file implements
 *
 * - **UNKNOWN renders as "unknown"**, never `0` and never blank
 *   (`fleetResourceStops.ts`).
 * - **`table_present: false` renders "not available"**, never an empty list: the
 *   coord table does not exist yet, so nothing was read.
 * - **A failed read renders its error beside the last rows**, marked
 *   last-known, never as an empty table.
 * - **Severity is coord's verdict, not the browser's.** The badge shows the
 *   recorded `warn` / `critical`; nothing here bands a reading.
 *
 * ## Presentation mode
 *
 * Machines read as their alias and carry no device id in their attributes.
 * Nothing else on a row names a repository, path or prompt: `what_class` is an
 * allowlisted token, and the free-text `reason` is not rendered.
 */

import { memo, useMemo } from "react";
import { OctagonAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CollapsiblePanel,
  RefreshButton,
  absoluteTime,
  relativeTime,
} from "@/components/console";
import {
  useMachineAliaser,
  usePresentationMode,
} from "@/components/presentation";
import {
  calibrationSummary,
  formatObservedVsLimit,
  formatSessions,
  formatStopCount,
  guardLaneLabel,
  suppressionNote,
  stopLaneLabel,
} from "./fleetResourceStops";
import type { ResourceStopRow } from "./fleetResourceStops";
import type { FleetDeviceRef } from "./fleetResources";
import { presentedFailureReason } from "./presentedFailure";
import type { UseFleetResourceStopsResult } from "./useFleetResourceStops";

export interface FleetResourceStopsSectionProps {
  /** Coord's device list: the join that turns a stop's `device_id` into a name. */
  devices: FleetDeviceRef[];
  /** The section's one `/fleet/resource-stops` poll. */
  stops: UseFleetResourceStopsResult;
  /** The ticking clock the parent keeps, so ages advance between polls. */
  nowMs: number;
}

export const FleetResourceStopsSection = memo(
  function FleetResourceStopsSection({
    devices,
    stops,
    nowMs,
  }: FleetResourceStopsSectionProps) {
    const { data, loading, error, refresh } = stops;
    const { presenting } = usePresentationMode();
    const machineName = useMachineAliaser();

    const hostnameById = useMemo(() => {
      const map = new Map<string, string | undefined>();
      for (const d of devices) map.set(d.device_id, d.hostname);
      return map;
    }, [devices]);

    // Only a literal `true` means the table was read. A missing or
    // non-boolean `table_present` is unknown, which renders as "not
    // available" and never as "No pressure stops recorded".
    const tableAbsent = data != null && data.table_present !== true;
    const rows: ResourceStopRow[] = tableAbsent ? [] : (data?.stops ?? []);
    const critical = rows.filter((r) => r.severity === "critical").length;

    return (
      <CollapsiblePanel
        data-testid="fleet-resource-stops-section"
        storageKey="fleet:resource-stops"
        icon={<OctagonAlert className="h-4 w-4" />}
        title="Pressure stops"
        contentClassName="space-y-3"
        summary={
          <>
            {data !== null && !tableAbsent && (
              <Badge
                variant="outline"
                className="ml-2"
                data-testid="fleet-resource-stops-count-badge"
              >
                {rows.length}
                {data.bounded ? "+" : ""} recorded
              </Badge>
            )}
            {critical > 0 && (
              <Badge
                variant="secondary"
                className="ml-1"
                data-testid="fleet-resource-stops-critical-badge"
              >
                {critical} critical
              </Badge>
            )}
            {tableAbsent && (
              <Badge
                variant="outline"
                className="ml-2"
                data-testid="fleet-resource-stops-unavailable-badge"
              >
                not available
              </Badge>
            )}
          </>
        }
        headerActions={
          <RefreshButton
            onRefresh={refresh}
            label="Refresh pressure stops"
            title="Re-reads the recorded pressure stops now"
            data-testid="fleet-resource-stops-refresh"
          />
        }
      >
        {error && (
          <p
            className="text-sm text-destructive"
            data-testid="fleet-resource-stops-error"
          >
            Pressure stops unavailable:{" "}
            {presentedFailureReason(error, presenting)}.
            {data ? " Rows below are last-known, not current." : ""}
          </p>
        )}

        {loading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : tableAbsent ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="fleet-resource-stops-not-available"
          >
            Not available: coord has not applied the pressure-stops table yet,
            so whether any stop happened is unknown.
          </p>
        ) : data === null ? null : rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic"
            data-testid="fleet-resource-stops-empty"
          >
            No pressure stops recorded.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">When</th>
                  <th className="py-1 pr-3 font-medium">Machine</th>
                  <th className="py-1 pr-3 font-medium">Kind</th>
                  <th className="py-1 pr-3 font-medium">Lane</th>
                  <th className="py-1 pr-3 font-medium">Severity</th>
                  <th className="py-1 pr-3 font-medium">What</th>
                  <th className="py-1 pr-3 font-medium">Observed vs limit</th>
                  <th className="py-1 pr-3 font-medium">Sessions</th>
                  <th className="py-1 pr-3 font-medium">CI runners</th>
                  <th className="py-1 pr-3 font-medium">Calibration</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const hostname = hostnameById.get(row.device_id);
                  const calibration = calibrationSummary(row);
                  return (
                    <tr
                      key={row.event_id}
                      className="border-t border-border/50"
                      data-testid="fleet-resource-stops-row"
                      data-device-id={presenting ? undefined : row.device_id}
                      data-stop-lane={row.lane}
                    >
                      <td
                        className="py-1.5 pr-3 text-[11px] whitespace-nowrap"
                        title={absoluteTime(row.observed_at)}
                      >
                        {relativeTime(row.observed_at, {
                          now: nowMs,
                          absent: "unknown",
                        })}
                      </td>
                      <td className="py-1.5 pr-3">
                        {machineName(
                          {
                            deviceId: row.device_id,
                            hostname: hostname ?? null,
                          },
                          hostname ?? row.device_id
                        )}
                      </td>
                      <td
                        className="py-1.5 pr-3 text-[11px]"
                        data-testid="fleet-resource-stops-kind"
                      >
                        {row.stop_kind}
                        {suppressionNote(row) && (
                          <span
                            className="ml-1 text-muted-foreground"
                            data-testid="fleet-resource-stops-suppressed"
                          >
                            ({suppressionNote(row)})
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-[11px]">
                        {stopLaneLabel(row.lane)}{" "}
                        <span className="ml-1 text-muted-foreground">
                          ({guardLaneLabel(row.guard_lane)})
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge
                          variant={
                            row.severity === "critical"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {row.severity}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-3 text-[11px]">
                        {row.what_class}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {formatObservedVsLimit(row)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {formatSessions(row)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {formatStopCount(row.active_ci_runners)}
                      </td>
                      <td className="py-1.5 pr-3 text-[11px]">
                        {calibration.effective}{" "}
                        <span className="ml-1 text-muted-foreground">
                          · fleet: {calibration.fleet}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data?.bounded && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Showing the newest {rows.length}; older stops are not shown.
              </p>
            )}
          </div>
        )}
      </CollapsiblePanel>
    );
  }
);
