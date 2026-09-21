"use client";

/**
 * Worktree allocation-slot occupancy per machine (plan
 * `2026-09-21-worktree-slots-devops-dashboard-view.md` Phase 3).
 *
 * One row per `device_id`, joined to the page's own device list the same
 * way `FleetResourceStrip` joins `fleetResources.ts`'s `buildMachineGroups`
 * — **the device list is the spine**. A device with no entry in
 * `GET /fleet/worktree-slots` (not registered on that door, or truncated out
 * by its device cap) still gets a row, rendered `unknown`, never silently
 * dropped. A device the response names that the caller's device list does
 * not is still rendered too, under its raw id — the same "don't discard a
 * machine that is publishing" rule `buildMachineGroups` states for resource
 * samples.
 *
 * ## The honesty rule this file implements
 *
 * `census_recent_rows === 0` means coord's fleet-worktree-slots route found
 * no `coord.worktree_census` row for that device within the narrow
 * (`census_window_secs`) window, so `active_worktrees` for that device could
 * not be corroborated as live. That is a DIFFERENT claim from "this machine
 * has genuinely allocated nothing" — see the plan's Why section for the
 * 68-row ledger-leak history behind the LATERAL join this depends on. The
 * `Slots` column renders that case as `unknown`, muted, with a tooltip —
 * **never** the raw `0/8`, which would read as a healthy, idle machine.
 *
 * A machine at `active_worktrees === max_worktrees` gets a `secondary`
 * "at cap" badge and nothing more — no client-derived red/amber colouring.
 * This feature has no coord-computed headroom verdict of its own to colour
 * against (unlike `AdmissionCell`'s `headroom`), and per DD5 of the related
 * 2026-09-19 plan ("Dev Ops renders coord's verdicts, it does not recompute
 * them") this section does not invent one.
 *
 * ## Independent poll, sibling component
 *
 * This owns its own `useFleetWorktreeSlots` poll rather than folding into
 * `FleetResourcesSection`: that section already owns ONE poll
 * (`/fleet/resource-samples`) shared by two panels reading the SAME rows;
 * worktree-slot occupancy is a second, independent fact from a different
 * coord route, and merging its poll into that section's would make one
 * `useEffect` own two unrelated cadences for no shared benefit. See
 * `devops/page.tsx`'s header comment for the fleet-wide "one route, one
 * poll" rationale this mirrors.
 */

import { useMemo } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
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
import { formatAge } from "./fleetResources";
import type { FleetDeviceRef } from "./fleetResources";
import { useFleetWorktreeSlots } from "./useFleetWorktreeSlots";
import type {
  WorktreeSlotDevice,
  WorktreeSlotOccupantRow,
} from "./useFleetWorktreeSlots";

interface WorktreeSlotRow {
  deviceId: string;
  displayName: string;
  /** `null` when this device has no entry in coord's response — UNKNOWN,
   * never dropped. */
  entry: WorktreeSlotDevice | null;
}

/**
 * Join coord's device list (the spine) to the worktree-slots response.
 * Exported for the page test's direct coverage of the join's edge cases.
 */
export function buildWorktreeSlotRows(
  devices: FleetDeviceRef[],
  data: { devices: WorktreeSlotDevice[] } | null
): WorktreeSlotRow[] {
  const byDevice = new Map<string, WorktreeSlotDevice>();
  for (const d of data?.devices ?? []) byDevice.set(d.device_id, d);

  const known = new Map<string, FleetDeviceRef>();
  for (const d of devices) known.set(d.device_id, d);
  // A device the response names that the caller's device list does not is
  // still rendered — dropping it would be the same class of lie as
  // discarding a machine that is publishing resource samples.
  for (const deviceId of byDevice.keys()) {
    if (!known.has(deviceId)) known.set(deviceId, { device_id: deviceId });
  }

  const rows: WorktreeSlotRow[] = [];
  for (const [deviceId, device] of known) {
    rows.push({
      deviceId,
      displayName: device.hostname || deviceId,
      entry: byDevice.get(deviceId) ?? null,
    });
  }
  return rows;
}

function OccupantsDisclosure({
  occupants,
}: {
  occupants: WorktreeSlotDevice["occupants"];
}) {
  if (occupants.total === 0) {
    return (
      <span className="text-[11px] text-muted-foreground italic">
        none allocated
      </span>
    );
  }
  return (
    <CollapsiblePanel
      data-testid="worktree-slots-occupants-disclosure"
      // No `storageKey`, deliberately: this is per-row detail, not a
      // section an operator's layout choice should persist across every
      // machine on every reload (mirrors `CiCapacityDisclosure`).
      defaultOpen={false}
      titleAs="div"
      icon={<GitBranch className="h-3 w-3" />}
      title={`Occupants (${occupants.total})`}
      className="border-dashed p-2"
      contentClassName="mt-2"
    >
      <ul className="space-y-1 text-[11px]">
        {occupants.rows.map((row: WorktreeSlotOccupantRow, i: number) => (
          <li key={`${row.repo}:${row.worktree_path}:${i}`}>
            <span className="font-medium">{row.repo}</span>{" "}
            <span className="text-muted-foreground">{row.worktree_path}</span>{" "}
            <span className="text-muted-foreground">
              {formatAge(row.age_secs)}
            </span>
            {row.building && (
              <Badge variant="outline" className="ml-1 text-[10px]">
                building
              </Badge>
            )}
          </li>
        ))}
      </ul>
      {occupants.truncated && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          +{occupants.total - occupants.shown} more (showing {occupants.shown}{" "}
          of {occupants.total})
        </p>
      )}
    </CollapsiblePanel>
  );
}

export function FleetWorktreeSlotsSection({
  devices,
}: {
  /** Coord's device list, from the page's existing `/fleet/health` poll —
   * same prop shape `FleetResourcesSection` takes, so both sections agree
   * about which machines exist. */
  devices: FleetDeviceRef[];
}) {
  const { data, loading, error, refresh } = useFleetWorktreeSlots();

  const rows = useMemo(
    () => buildWorktreeSlotRows(devices, data),
    [devices, data]
  );

  const { atCap, unknown } = useMemo(() => {
    let atCapCount = 0;
    let unknownCount = 0;
    for (const row of rows) {
      if (row.entry === null || row.entry.census_recent_rows === 0) {
        unknownCount += 1;
      } else if (row.entry.active_worktrees === row.entry.max_worktrees) {
        atCapCount += 1;
      }
    }
    return { atCap: atCapCount, unknown: unknownCount };
  }, [rows]);

  return (
    <TooltipProvider delayDuration={100}>
      <CollapsiblePanel
        data-testid="fleet-worktree-slots-section"
        storageKey="fleet:worktree-slots"
        icon={<GitBranch className="h-4 w-4" />}
        title="Worktree slots"
        contentClassName="space-y-3"
        summary={
          <>
            <Badge variant="outline" className="ml-2">
              {rows.length} machines
            </Badge>
            {atCap > 0 && (
              <Badge
                variant="secondary"
                className="ml-1"
                data-testid="fleet-worktree-slots-at-cap-badge"
              >
                {atCap} at cap
              </Badge>
            )}
            {unknown > 0 && (
              <Badge
                variant="outline"
                className="ml-1"
                data-testid="fleet-worktree-slots-unknown-badge"
              >
                {unknown} unknown
              </Badge>
            )}
          </>
        }
        headerActions={
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            data-testid="fleet-worktree-slots-refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        }
      >
        {error && (
          <p
            className="text-sm text-destructive"
            data-testid="fleet-worktree-slots-error"
          >
            Worktree slots unavailable: {error}. Rows below are last-known, not
            current.
          </p>
        )}
        {data?.truncated && (
          <p className="text-[11px] text-muted-foreground">
            Device list truncated at coord&apos;s cap ({data.device_cap}) — some
            machines are not shown.
          </p>
        )}

        {loading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No devices registered for this tenant.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Machine</th>
                  <th className="py-1 pr-3 font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="underline decoration-dotted">
                          Slots
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[22rem] text-[11px]">
                        Active worktree allocations against the fleet-wide cap (
                        <code>COORD_MAX_WORKTREES</code>, default 8). Not
                        per-device-tunable today.
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-1 pr-3 font-medium">Occupants</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const entry = row.entry;
                  const isUnknown =
                    entry === null || entry.census_recent_rows === 0;
                  const atCapRow =
                    !isUnknown &&
                    entry!.active_worktrees === entry!.max_worktrees;
                  return (
                    <tr
                      key={row.deviceId}
                      className="border-t border-border/50"
                      data-testid="fleet-worktree-slots-row"
                      data-device-id={row.deviceId}
                      data-worktree-slots-state={
                        isUnknown ? "unknown" : "known"
                      }
                    >
                      <td className="py-1.5 pr-3">{row.displayName}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-[11px]">
                        {isUnknown ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="text-muted-foreground italic underline decoration-dotted"
                                data-testid="fleet-worktree-slots-unknown-cell"
                              >
                                unknown
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[22rem] text-[11px]">
                              coord has no recent census for this device; the
                              worktree count above cannot be corroborated as
                              live.
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <>
                            {entry!.active_worktrees}/{entry!.max_worktrees}
                            {atCapRow && (
                              <Badge
                                variant="secondary"
                                className="ml-1 text-[10px]"
                                data-testid="fleet-worktree-slots-at-cap"
                              >
                                at cap
                              </Badge>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        {entry === null ? (
                          <span className="text-[11px] text-muted-foreground italic">
                            not reported
                          </span>
                        ) : (
                          <OccupantsDisclosure occupants={entry.occupants} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsiblePanel>
    </TooltipProvider>
  );
}
