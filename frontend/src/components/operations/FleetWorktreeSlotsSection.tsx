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
 * ## The page owns the poll
 *
 * The section used to open its own `useFleetWorktreeSlots` poll. Plan
 * `2026-10-23-console-presentation-spaces` Phase 7 lifted it to the Dev Ops
 * page, because the presentation headline's "agent workspaces in use" figure
 * reads the same answer: one route, one poll (see `devops/page.tsx`'s header
 * comment), and the join both readers use is `fleetWorktreeSlots.ts`'s.
 *
 * ## Presentation mode
 *
 * The section opens with its caption and the read's as-of; each machine reads
 * as its alias, and carries no device id in its attributes; an occupant's
 * repository renders through `RedactedText` and its worktree path not at all,
 * because a path names repositories and agents an outsider may not see.
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
import { CollapsiblePanel, NAVIGATION_ONLY_PROPS } from "@/components/console";
import {
  RedactedText,
  SectionCaption,
  useMachineAliaser,
  usePresentationMode,
} from "@/components/presentation";
import { DEVOPS_SOURCES } from "./devOpsHeadline";
import { formatAge } from "./fleetResources";
import type { FleetDeviceRef } from "./fleetResources";
import { buildWorktreeSlotRows, slotRowIsKnown } from "./fleetWorktreeSlots";
import type {
  UseFleetWorktreeSlotsResult,
  WorktreeSlotDevice,
  WorktreeSlotOccupantRow,
} from "./useFleetWorktreeSlots";

/**
 * When an occupant was allocated — the descriptor's age in presentation mode:
 * the moment the read ANSWERED, less coord's `age_secs` as of that answer.
 *
 * Anchored to the answer, never to `Date.now()`: the page re-renders every
 * 15 s, so an instant rebuilt from the clock on each render slides with it
 * and the age stays at whatever coord last said, however long the read has
 * been failing — the frozen age `presentationClock.ts` exists to prevent ("an
 * age that stops advancing is a false claim"). `null` (age unknown) when coord
 * sent no age, or no answer is dated.
 */
function allocatedAt(
  ageSecs: number | null,
  answeredAtMs: number | null
): string | null {
  if (ageSecs === null || !Number.isFinite(ageSecs) || answeredAtMs === null) {
    return null;
  }
  return new Date(answeredAtMs - Math.max(0, ageSecs) * 1_000).toISOString();
}

function OccupantsDisclosure({
  occupants,
  answeredAtMs,
}: {
  occupants: WorktreeSlotDevice["occupants"];
  /** When the read these occupants came from answered (`fetchedAtMs`). */
  answeredAtMs: number | null;
}) {
  const { presenting } = usePresentationMode();
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
          <li key={presenting ? i : `${row.repo}:${row.worktree_path}:${i}`}>
            {presenting ? (
              // The repository only when it is provably the tenant's own; the
              // path never — it names repositories and agents (D3.3). The
              // descriptor carries the age, so it is not repeated beside it.
              <RedactedText
                className="font-medium"
                text={row.repo}
                repo={row.repo}
                descriptor={{
                  kind: "Agent workspace",
                  status: row.building ? "building" : "allocated",
                  at: allocatedAt(row.age_secs, answeredAtMs),
                }}
              />
            ) : (
              <>
                <span className="font-medium">{row.repo}</span>{" "}
                <span className="text-muted-foreground">
                  {row.worktree_path}
                </span>{" "}
                <span className="text-muted-foreground">
                  {formatAge(row.age_secs)}
                </span>
              </>
            )}
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
  slots,
}: {
  /** Coord's device list, from the page's existing `/fleet/health` poll —
   * same prop shape `FleetResourcesSection` takes, so both sections agree
   * about which machines exist. */
  devices: FleetDeviceRef[];
  /** The page's one `/fleet/worktree-slots` poll (`useFleetWorktreeSlots`). */
  slots: UseFleetWorktreeSlotsResult;
}) {
  const { data, loading, error, fetchedAtMs, refresh } = slots;
  const { presenting } = usePresentationMode();
  const machineName = useMachineAliaser();

  const rows = useMemo(
    () => buildWorktreeSlotRows(devices, data),
    [devices, data]
  );

  const { atCap, unknown } = useMemo(() => {
    let atCapCount = 0;
    let unknownCount = 0;
    for (const row of rows) {
      if (!slotRowIsKnown(row)) {
        unknownCount += 1;
      } else if (row.entry.active_worktrees === row.entry.max_worktrees) {
        atCapCount += 1;
      }
    }
    return { atCap: atCapCount, unknown: unknownCount };
  }, [rows]);

  return (
    <TooltipProvider delayDuration={100}>
      <SectionCaption
        id="dev-ops.worktree-slots"
        sources={[{ source: DEVOPS_SOURCES.worktreeSlots, asOf: fetchedAtMs }]}
      />
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
            // A re-read: it changes only what is displayed (D3.2).
            {...NAVIGATION_ONLY_PROPS}
            variant="ghost"
            size="sm"
            onClick={refresh}
            aria-label="Refresh worktree slots"
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
                      {/* The fleet-wide `COORD_MAX_WORKTREES` this tooltip
                          once named is retired (qontinui-coord
                          `policies/isolation.rs` `MIN_DEVICE_WORKTREES`), so
                          it states only that the cap is the one coord reports
                          for the row. */}
                      <TooltipContent
                        className="max-w-[22rem] text-[11px]"
                        data-testid="fleet-worktree-slots-cap-tip"
                      >
                        {presenting
                          ? "Agent workspaces in use, against the limit reported for this machine."
                          : "Active worktree allocations against the cap coord reports for this machine."}
                      </TooltipContent>
                    </Tooltip>
                  </th>
                  <th className="py-1 pr-3 font-medium">Occupants</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const entry = row.entry;
                  const isUnknown = !slotRowIsKnown(row);
                  const atCapRow =
                    !isUnknown &&
                    entry!.active_worktrees === entry!.max_worktrees;
                  return (
                    <tr
                      key={row.deviceId}
                      className="border-t border-border/50"
                      data-testid="fleet-worktree-slots-row"
                      // No device id in front of an outsider (D3.3).
                      data-device-id={presenting ? undefined : row.deviceId}
                      data-worktree-slots-state={
                        isUnknown ? "unknown" : "known"
                      }
                    >
                      <td className="py-1.5 pr-3">
                        {machineName(
                          { deviceId: row.deviceId, hostname: row.hostname },
                          row.displayName
                        )}
                      </td>
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
                              {presenting
                                ? "This machine has sent no recent count, so how many workspaces it holds is unknown."
                                : "coord has no recent census for this device; the worktree count above cannot be corroborated as live."}
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
                          <OccupantsDisclosure
                            occupants={entry.occupants}
                            answeredAtMs={fetchedAtMs}
                          />
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
