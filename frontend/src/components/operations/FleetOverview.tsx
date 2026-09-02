"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Server,
  HeartPulse,
  Play,
  Terminal,
  RefreshCw,
  WifiOff,
  Cog,
  HardDrive,
  AlertTriangle,
} from "lucide-react";
import { MachineCard } from "./MachineCard";
import { DeviceStatusTile } from "./DeviceStatusTile";
import { TaskRunCard } from "./TaskRunCard";
import { useDeviceStatusStream } from "./useDeviceStatusStream";
import { useSymbolClaimsStream } from "./useSymbolClaimsStream";
import { httpClient } from "@/services/service-factory";
import {
  FLEET_VOLUMES_API,
  formatBytes,
  OPERATIONS_API,
  POLL_INTERVAL_MS,
  relativeTime,
  volumeSeverity,
} from "./utils";
import { CollapsiblePanel } from "@/components/console";
import {
  indexDeviceVolumes,
  parseFleetVolumes,
  resolveMachineVolumes,
  tightestVolume,
  volumesReliabilityWarning,
  VOLUMES_NOT_YET_READ,
  type VolumesFetch,
} from "./fleetVolumes";
import type { FleetHealthDevice, UseFleetHealthResult } from "./useFleetHealth";
import { resolveCiCapacity, type DevenvMachinesRead } from "./ciCapacity";
import {
  describeMirrorFreshness,
  mergeCiRunners,
  type CiRunnerMirrorRead,
} from "./ciRunnerMirror";
import type {
  CiRunnerInfo,
  CiRunnersByHost,
  DeviceStatus,
  FleetStatus,
  AggregatedTaskRuns,
  MachineGroup,
  MachineVolumes,
  RunnerTaskRun,
  SymbolClaim,
} from "./types";

/** Stable empty identities — see the `useMemo` in `FleetOverview`. */
const EMPTY_DEVICES: FleetHealthDevice[] = [];
const EMPTY_FLEET: FleetStatus = {
  runners: [],
  claude_sessions: {},
  total_runners: 0,
  total_healthy: 0,
  total_running_tasks: 0,
  total_claude_sessions: 0,
};

// ============================================================================
// Helper: build machine groups from fleet status
// ============================================================================

function buildMachineGroups(
  fleet: FleetStatus,
  deviceStatusByHost: Map<string, DeviceStatus>,
  symbolClaimsByMachine: Map<string, SymbolClaim[]>,
  volumesFetch: VolumesFetch,
  /**
   * Coord's `/operations/fleet/health` devices.
   *
   * Always an array now: the mount that built this list WITHOUT the coord read
   * (the pipeline page) is gone as of Phase 4 of
   * `2026-08-25-coord-console-intent-and-devops-sections`, so every group ends
   * up with a `coordHealth` — `{matched: true, …}` or `{matched: false}`. An
   * EMPTY array is still a read that happened and found nothing, which is why
   * it is not the same as the old `null`.
   */
  coordDevices: FleetHealthDevice[],
  /**
   * The per-host CI facts, ALREADY MERGED by the caller.
   *
   * Merged rather than derived here so there is exactly one merged map per
   * render: the stat row counts off the same object the cards are built from,
   * and two `mergeCiRunners` calls would be two chances for the `CI Runners
   * x/y` badge and the rows beneath it to disagree.
   *
   * It matters that this is merged at all — the GitHub fleet's rows are
   * structurally invisible to `GET /operations/fleet` (coord's registrar writes
   * them with no `user_id` and no `capability_user_paired`, and the device read
   * requires both), so `fleet.ci_runners` alone is empty for exactly the hosts
   * an operator came here to look at. See `ciRunnerMirror.ts`.
   */
  ciRunners: CiRunnersByHost
): MachineGroup[] {
  const byHost = new Map<string, MachineGroup>();
  const displayNames: Record<string, string> =
    fleet.machine_display_names ?? {};

  // The symbol-claims map is keyed by machine_id (UUID); the MachineGroup
  // is keyed by hostname. Symbol claims arrive from coord BEFORE the
  // matching device_status row (the supervisor's symbol_watcher daemon
  // is independent of the agent's /coord/status writer), so we
  // pre-resolve hostname → machine_id via device_status to look up
  // claims by hostname.
  const resolveClaims = (activity: DeviceStatus | undefined): SymbolClaim[] => {
    if (!activity) return [];
    return symbolClaimsByMachine.get(activity.device_id) ?? [];
  };

  const resolveCiRunner = (hostname: string): CiRunnerInfo | undefined => {
    return ciRunners[hostname];
  };

  const resolveVolumes = (
    hostname: string,
    activity: DeviceStatus | undefined,
    fallbackDeviceId?: string
  ): MachineVolumes =>
    resolveMachineVolumes(hostname, activity, volumesFetch, fallbackDeviceId);

  for (const runner of fleet.runners) {
    const hostname = runner.hostname ?? "unknown";
    let group = byHost.get(hostname);
    if (!group) {
      const activity = deviceStatusByHost.get(hostname);
      group = {
        hostname,
        displayName: displayNames[hostname],
        runners: [],
        claudeSessions: fleet.claude_sessions[hostname] ?? [],
        currentActivity: activity,
        currentlyEditing: resolveClaims(activity),
        ciRunner: resolveCiRunner(hostname),
        volumes: resolveVolumes(hostname, activity),
      };
      byHost.set(hostname, group);
    }
    group.runners.push(runner);
  }

  // Also add hostnames that only have Claude sessions (no runner)
  for (const [hostname, sessions] of Object.entries(fleet.claude_sessions)) {
    if (!byHost.has(hostname)) {
      const activity = deviceStatusByHost.get(hostname);
      byHost.set(hostname, {
        hostname,
        displayName: displayNames[hostname],
        runners: [],
        claudeSessions: sessions,
        currentActivity: activity,
        currentlyEditing: resolveClaims(activity),
        ciRunner: resolveCiRunner(hostname),
        volumes: resolveVolumes(hostname, activity),
      });
    }
  }

  // ...and any hostnames that ONLY appear in device_status (an agent
  // posted to /coord/status from a machine that's not running a runner
  // and has no CC session detected). Surface them so the operator
  // sees the device-status row in context rather than hidden inside
  // the bottom-of-page DeviceStatusTile alone.
  for (const [hostname, currentActivity] of deviceStatusByHost.entries()) {
    if (!byHost.has(hostname)) {
      byHost.set(hostname, {
        hostname,
        displayName: displayNames[hostname],
        runners: [],
        claudeSessions: [],
        currentActivity,
        currentlyEditing: resolveClaims(currentActivity),
        ciRunner: resolveCiRunner(hostname),
        volumes: resolveVolumes(hostname, currentActivity),
      });
    }
  }

  // ...and any host that is PURELY CI infrastructure. The backend excludes
  // CI-runner devices from `fleet.runners` (that is the categorisation), so a
  // dedicated CI host reaches this point with no group at all. These are live
  // infrastructure, not clutter: they must stay in the fleet, just in their own
  // category rather than padding the workstation list. Any host that already
  // has a group keeps it and is NOT reclassified.
  //
  // For MIRROR rows the "already has a group" case is unreachable rather than
  // merely rare: `ci_runner_registrar::hostname_for` mints a synthetic
  // `gh-runner-<name>`, which never equals a machine's hostname. So a physical
  // CI host appears TWICE by design — once as its workstation card, once as the
  // GitHub registration it hosts — and those are genuinely two coord devices
  // with two different capability sets. Do not "fix" that by joining on
  // hostname; the two rows answer different questions.
  for (const hostname of Object.keys(ciRunners)) {
    if (!byHost.has(hostname)) {
      const activity = deviceStatusByHost.get(hostname);
      byHost.set(hostname, {
        hostname,
        displayName: displayNames[hostname],
        runners: [],
        claudeSessions: [],
        currentActivity: activity,
        currentlyEditing: resolveClaims(activity),
        ciRunner: ciRunners[hostname],
        isCiInfrastructure: true,
        // The runner inventory has no row for this host — it reached the list
        // through the CI mirror alone. Saying so is what keeps the card footer
        // on "runners: unknown · CC sessions: unknown" instead of the measured
        // "0 of 0 healthy · 0 CC sessions" an exclusion is not. Before the
        // mirror existed these hosts arrived through the `coordDevices` loop
        // below, which sets the same flag; the mirror now claims them first, so
        // it has to set it too or Phase 2 silently converts an unknown into a
        // zero.
        coordHealthOnly: true,
        // CI hosts get REAL disk telemetry, not an exemption. A dedicated CI
        // box is exactly the machine whose disk fills with build artifacts —
        // resolving this to a placeholder would blind the one category that
        // most needs watching.
        // The mirror row's own `device_id` is the fallback key. Without it a
        // `gh-runner-*` row resolves volumes by a SYNTHETIC hostname, misses,
        // and renders "no coord device row in view" for a device coord plainly
        // has — directly under the comment above promising real telemetry.
        volumes: resolveVolumes(
          hostname,
          activity,
          ciRunners[hostname]?.deviceId
        ),
      });
    }
  }

  // ...and coord's own device list, when this mount was given it. This is the
  // MERGE the Dev Ops Overview exists for: one row per machine carrying both
  // coord's `DeviceState` and the runner/session/CI facts, rather than two
  // lists with two notions of "healthy" on one page.
  //
  // A coord device that matches no group does NOT vanish — it becomes a row
  // whose runner-side facts are UNKNOWN (`coordHealthOnly`). A group that
  // matches no coord device gets `{matched: false}`, which renders `unknown`
  // too, and says why.
  for (const device of coordDevices) {
    const hostname = device.hostname ?? device.device_id;
    const group = byHost.get(hostname);
    const join = {
      matched: true as const,
      device_id: device.device_id,
      state: device.state,
    };
    if (group) {
      group.coordHealth = join;
      continue;
    }
    const activity = deviceStatusByHost.get(hostname);
    byHost.set(hostname, {
      hostname,
      displayName: displayNames[hostname],
      runners: [],
      claudeSessions: [],
      currentActivity: activity,
      currentlyEditing: resolveClaims(activity),
      ciRunner: resolveCiRunner(hostname),
      volumes: resolveVolumes(hostname, activity, device.device_id),
      coordHealth: join,
      coordHealthOnly: true,
    });
  }
  for (const group of byHost.values()) {
    if (!group.coordHealth) group.coordHealth = { matched: false };
  }

  // Sort: healthy machines first, then alphabetically
  return Array.from(byHost.values()).sort((a, b) => {
    const aHealthy = a.runners.some((r) => r.derivedStatus === "healthy")
      ? 0
      : 1;
    const bHealthy = b.runners.some((r) => r.derivedStatus === "healthy")
      ? 0
      : 1;
    if (aHealthy !== bHealthy) return aHealthy - bHealthy;
    return a.hostname.localeCompare(b.hostname);
  });
}

// ============================================================================
// Stat badge component
// ============================================================================

function StatBadge({
  icon: Icon,
  label,
  value,
  variant = "outline",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  variant?: "outline" | "default" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/30">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant={variant} className="ml-auto text-xs">
        {value}
      </Badge>
    </div>
  );
}

// ============================================================================
// Main FleetOverview
// ============================================================================

export interface FleetOverviewProps {
  /**
   * Coord's device-liveness read (`useFleetHealth`).
   *
   * REQUIRED since Phase 4 of
   * `2026-08-25-coord-console-intent-and-devops-sections`, which deleted the
   * pipeline page's mount — the only caller that ever omitted it. This list IS
   * the machine list: coord's `DeviceState` is merged onto each row, the
   * per-device cross-links ride along, and a coord device that appears in no
   * runner inventory gets a row of its own rather than disappearing. That is
   * why the Dev Ops Overview has exactly ONE machine list and no separate
   * health card.
   *
   * Do not make this optional again to serve a second mount. The optional arm
   * was a SECOND definition of "healthy" rendered beside this one, and two
   * notions of healthy on one console is a correctness defect, not a layout
   * preference.
   */
  health: UseFleetHealthResult;
  /**
   * The devenv machine roster (`useDevenvMachines`), supplied by the Dev Ops
   * Overview so each row can resolve its CI-capacity join and mount the shared
   * `CiNodeConfigPanel` behind a collapsed disclosure.
   *
   * This component neither reads it nor caches it: the page owns the one read
   * and this passes the resolved join down. Required for the same reason
   * `health` is — the mount that omitted it is gone, and a row that resolves
   * the join from nothing would be reporting on a read nobody made.
   */
  ciMachines: DevenvMachinesRead;
  /**
   * Coord's CI-runner mirror (`useCiRunnerMirror`), supplied by the Dev Ops
   * Overview — plan `2026-08-20-fleet-page-runner-enable-disable-switch`
   * Phase 2.
   *
   * Required, like the other two: a mount that omitted it would render the
   * GitHub fleet's hosts with no labels at all, which reads as "this host
   * advertises nothing" rather than as "nobody looked". This component neither
   * reads nor caches it; the page owns the one poll.
   */
  ciRunnerMirror: CiRunnerMirrorRead;
}

export function FleetOverview({
  health,
  ciMachines,
  ciRunnerMirror,
}: FleetOverviewProps) {
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [tasks, setTasks] = useState<AggregatedTaskRuns | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [volumes, setVolumes] = useState<VolumesFetch>(VOLUMES_NOT_YET_READ);

  const fetchData = useCallback(async () => {
    try {
      const [fleetRes, tasksRes, volumesRes] = await Promise.allSettled([
        httpClient.fetch(`${OPERATIONS_API}/fleet`),
        httpClient.fetch(`${OPERATIONS_API}/fleet/tasks`),
        httpClient.fetch(FLEET_VOLUMES_API),
      ]);

      if (fleetRes.status === "fulfilled" && fleetRes.value.ok) {
        const data: FleetStatus = await fleetRes.value.json();
        setFleet(data);
        setError(null);
      } else {
        const reason =
          fleetRes.status === "rejected"
            ? (fleetRes.reason as Error).message
            : `HTTP ${fleetRes.value.status}`;
        setError(`Operations API unreachable: ${reason}`);
      }

      if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
        const data: AggregatedTaskRuns = await tasksRes.value.json();
        setTasks(data);
      } else {
        // Tasks endpoint failing is non-critical
        setTasks({ task_runs: [], total: 0 });
      }

      // Disk telemetry. Every failure path lands on `unavailable` WITH the
      // reason — a failed read must never degrade into "this device has never
      // reported", which is a claim about the device rather than about the
      // read (plan D10 / `silent-empty-is-unknown`).
      if (volumesRes.status === "rejected") {
        setVolumes({
          state: "unavailable",
          reason: `Request to ${FLEET_VOLUMES_API} failed: ${
            (volumesRes.reason as Error)?.message ?? "unknown error"
          }`,
        });
      } else if (!volumesRes.value.ok) {
        setVolumes({
          state: "unavailable",
          reason:
            `The fleet-volumes read returned HTTP ${volumesRes.value.status}. ` +
            `Coord may be unreachable (502/504) or the volumes route may not ` +
            `be deployed yet.`,
        });
      } else {
        let payload: unknown;
        try {
          payload = await volumesRes.value.json();
        } catch (err) {
          payload = undefined;
          setVolumes({
            state: "unavailable",
            reason: `The fleet-volumes response was not valid JSON: ${
              err instanceof Error ? err.message : "parse error"
            }`,
          });
        }
        if (payload !== undefined) {
          const parsed = parseFleetVolumes(payload);
          if (parsed.state === "unparseable") {
            setVolumes({
              state: "unavailable",
              reason:
                "The fleet-volumes response could not be parsed: it either " +
                "matched no known shape (expected `{devices: [...]}` or " +
                "`{volumes: [...]}`) or carried rows that named no device, so " +
                "no device could be matched to a reading. This says nothing " +
                "about any machine's disk -- an EMPTY response parses fine " +
                "and reports itself as such.",
            });
          } else {
            // A PARTLY readable response keeps its readable half (the parse's
            // `skippedRows` rides along), and the render withdraws the
            // never-reported claims instead of throwing the data away.
            setVolumes(indexDeviceVolumes(parsed.devices, parsed.skippedRows));
          }
        }
      }

      setLastUpdated(new Date());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to reach operations API";
      setError(message);
      // The disk section must not keep presenting the previous readings as if
      // this refresh had confirmed them.
      setVolumes({
        state: "unavailable",
        reason: `The fleet refresh failed before disk telemetry could be read: ${message}`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const deviceStatus = useDeviceStatusStream();
  const symbolClaims = useSymbolClaimsStream();

  // Stable identity: `?? []` would allocate a fresh array every render and
  // defeat the memo below.
  const coordDevices = health.data?.devices ?? EMPTY_DEVICES;

  // The mirror WINS for status and labels where both carry a host: it is the
  // copy derived from GitHub's own listing, and the routing verdict has to be
  // computed from that one. A mirror read that has not answered contributes
  // nothing and removes nothing. Computed ONCE, here, and handed to both the
  // row builder and the stat row.
  const mergedCiRunners = useMemo(
    () => mergeCiRunners(fleet?.ci_runners ?? {}, ciRunnerMirror),
    [fleet, ciRunnerMirror]
  );

  const machineGroups = useMemo(
    () =>
      fleet
        ? buildMachineGroups(
            fleet,
            deviceStatus.byHostname,
            symbolClaims.byMachine,
            volumes,
            coordDevices,
            mergedCiRunners
          )
        : // The runner-inventory read failed or has not landed, but coord's
          // device list may have. Those machines still exist — render them
          // with their runner-side facts UNKNOWN rather than showing nothing,
          // which would read as an empty fleet.
          buildMachineGroups(
            EMPTY_FLEET,
            deviceStatus.byHostname,
            symbolClaims.byMachine,
            volumes,
            coordDevices,
            mergedCiRunners
          ),
    [
      fleet,
      deviceStatus.byHostname,
      symbolClaims.byMachine,
      volumes,
      coordDevices,
      mergedCiRunners,
    ]
  );

  // Counted off the MERGED map the cards are built from, not off
  // `fleet.ci_runners` — which is empty for the GitHub fleet, and was the
  // reason the `CI Runners x/y` stat read `0/0` beside three live hosts.
  //
  // `idle`/`busy` explicitly, never `!== "offline"`. With `unknown` now a real
  // status, the negative form would count a runner nobody has heard from as
  // active — a wrong number in the direction that hides a problem.
  const activeCiRunners = useMemo(
    () =>
      Object.values(mergedCiRunners).filter(
        (ci) => ci.status === "idle" || ci.status === "busy"
      ).length,
    [mergedCiRunners]
  );

  const totalCiRunners = useMemo(
    () => Object.keys(mergedCiRunners).length,
    [mergedCiRunners]
  );

  /**
   * Fleet-level headline: the TIGHTEST volume anywhere in the fleet — the
   * number that actually predicts the next "0 bytes free" incident. Never
   * renders `0 B` and never renders green without a reading behind it.
   *
   * The two no-number cases are LABELLED DIFFERENTLY, because this badge is the
   * first thing an operator looks at and they are different facts: "not read"
   * (the fleet-volumes read did not answer — says nothing about any disk) vs
   * "none reported" (the read answered, and no device has telemetry yet).
   * Collapsing both into "unknown" is the same conflation the parse layer was
   * fixed for.
   */
  const worstFreeVolume = useMemo(() => tightestVolume(volumes), [volumes]);
  const worstSeverity = worstFreeVolume
    ? volumeSeverity(worstFreeVolume.free_bytes)
    : null;
  const volumesRead = volumes.state === "ok";
  /**
   * Set when the response was only PARTLY readable. The rows that were dropped
   * named no device, so they cannot be attributed to a machine — which means
   * the "no telemetry" labels on the cards below are unreliable for this
   * refresh, and the page has to say so where the operator will see it rather
   * than silently under-reporting.
   */
  const volumesWarning = volumesReliabilityWarning(volumes);

  const runningTasks: RunnerTaskRun[] = useMemo(
    () =>
      (tasks?.task_runs ?? []).filter((t) => {
        const s = t.status.toLowerCase();
        return s === "running" || s === "in_progress";
      }),
    [tasks]
  );

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-40 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ---- Error / empty state ----
  // Fleet API unreachable. The device-status stream is a separate request
  // path (the coord proxy + WS bridge), so it may still have data — render
  // the tile alongside the fleet-error notice rather than short-circuiting
  // it out.
  if (error && !fleet && coordDevices.length === 0) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className="space-y-6">
          <div className="flex flex-col items-center justify-center gap-4 py-12 text-muted-foreground">
            <WifiOff className="h-12 w-12 opacity-40" />
            <p className="text-lg font-medium">Backend Unreachable</p>
            <p className="text-sm max-w-md text-center">{error}</p>
            <p className="text-xs">
              Make sure the backend is running at{" "}
              <code className="bg-muted px-1 rounded">localhost:8000</code> and
              the operations endpoints are deployed.
            </p>
          </div>
          <DeviceStatusTile stream={deviceStatus} />
        </div>
      </TooltipProvider>
    );
  }

  // Empty means there is genuinely no machine to draw. This used to key off
  // `total_runners`/`total_claude_sessions` alone, which hid device-status-only
  // and CI-only hosts behind a "No runners online" panel even though the list
  // had rows for them — and would now hide coord's own devices the same way.
  const isEmpty = machineGroups.length === 0;

  return (
    <TooltipProvider delayDuration={200}>
      <CollapsiblePanel
        data-testid="coord-devops-machines"
        storageKey="devops:machines"
        icon={<Server className="h-4 w-4" />}
        // Merged, this is not "an overview of the fleet" beside a second
        // machine list — it IS the machine list, so it is named for what its
        // rows are.
        title="Machines"
        summary={
          <Badge variant="outline" className="text-[10px]">
            {machineGroups.length}
          </Badge>
        }
      >
        <div className="space-y-6">
          {/* A PARTLY readable fleet-volumes response. This sits ABOVE the
              cards, not in a footnote, because it changes how the cards below
              must be read: the skipped rows named no device, so any machine
              shown without telemetry may in fact have reported. */}
          {volumesWarning && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2"
              role="status"
              data-operations-volumes-partial
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                  Disk telemetry only partly readable
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {volumesWarning}
                </p>
              </div>
            </div>
          )}

          {/* The coord health read's own failure. Reported next to the rows it
              affects rather than swallowed: with the read down, every row's
              coord state below is the LAST one seen, not a current one. */}
          {health.error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-2"
              role="status"
              data-testid="coord-devops-health-error"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                  Coord fleet-health read failed
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {health.error} -- the coord state on each row below is the
                  last one read, not a current one, and a machine coord has
                  learned about since may be missing entirely.
                </p>
              </div>
            </div>
          )}

          {/* The CI-runner label mirror's own provenance and age — plan
              `2026-08-20-fleet-page-runner-enable-disable-switch` Phase 2,
              §5 Q2. Stated ABOVE the rows rather than in a footnote, because
              it changes what the label chips below mean: they are the set
              coord's ~60s registrar poll last mirrored from GitHub, not a live
              read of GitHub, and a page that implies otherwise will one day
              tell an operator a delabelled host is fine. When the read failed,
              the same line says the label state is UNKNOWN — never that a host
              advertises nothing. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="ci-runner-mirror-freshness"
            data-ci-runner-mirror={ciRunnerMirror.state}
          >
            {describeMirrorFreshness(ciRunnerMirror)}
          </p>

          {/* Machine cards grid */}
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Server className="h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">No runners online</p>
              <p className="text-xs max-w-sm text-center">
                Connect a runner via Settings → Backend Connection, or launch a
                Claude Code session on any machine to see it here.
              </p>
            </div>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Machines
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {machineGroups.map((group) => (
                  <MachineCard
                    key={group.hostname}
                    machine={group}
                    onRenamed={fetchData}
                    // The join is resolved here, per row, from the page's one
                    // read — never fetched per card. A row coord's health read
                    // does not name has no `device_id` to match on, and says
                    // so rather than claiming no machine is linked.
                    ciCapacity={
                      ciMachines
                        ? resolveCiCapacity(
                            ciMachines,
                            group.coordHealth?.matched
                              ? group.coordHealth.device_id
                              : undefined
                          )
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Device status broadcast (qontinui-coord Phase 6 Item 3) */}
          <DeviceStatusTile stream={deviceStatus} />

          {/* Summary stats row */}
          <div className="flex flex-wrap items-center gap-3">
            <StatBadge
              icon={Server}
              label="Runners"
              value={fleet?.total_runners ?? 0}
            />
            <StatBadge
              icon={HeartPulse}
              label="Healthy"
              value={fleet?.total_healthy ?? 0}
              variant={
                fleet && fleet.total_healthy < fleet.total_runners
                  ? "warning"
                  : "success"
              }
            />
            <StatBadge
              icon={Play}
              label="Running Tasks"
              value={fleet?.total_running_tasks ?? 0}
            />
            <StatBadge
              icon={Terminal}
              label="CC Sessions"
              value={fleet?.total_claude_sessions ?? 0}
            />
            {totalCiRunners > 0 && (
              <StatBadge
                icon={Cog}
                label="CI Runners"
                value={`${activeCiRunners}/${totalCiRunners}`}
                variant={activeCiRunners > 0 ? "success" : "outline"}
              />
            )}
            <StatBadge
              icon={HardDrive}
              label="Tightest volume"
              value={
                worstFreeVolume
                  ? `${formatBytes(worstFreeVolume.free_bytes)} free (${worstFreeVolume.volume})`
                  : !volumesRead
                    ? "not read"
                    : volumesWarning
                      ? "partial read"
                      : "none reported"
              }
              variant={
                worstSeverity === "critical"
                  ? "destructive"
                  : worstSeverity === "warn"
                    ? "warning"
                    : worstSeverity === "ok"
                      ? "success"
                      : "outline"
              }
            />

            {/* Refresh indicator */}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw
                className="h-3 w-3 animate-spin"
                style={{ animationDuration: "3s" }}
              />
              <span>
                Updated{" "}
                {lastUpdated ? relativeTime(lastUpdated.toISOString()) : "--"}
              </span>
              {error && (
                <Badge variant="destructive" className="text-[10px]">
                  partial error
                </Badge>
              )}
            </div>
          </div>

          {/* Active workflows */}
          {runningTasks.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Active Workflows ({runningTasks.length})
              </h2>
              <div className="space-y-3">
                {runningTasks.map((task) => (
                  <TaskRunCard
                    key={`${task.runner_id}-${task.id}`}
                    task={task}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All tasks (including completed/non-running) */}
          {tasks && tasks.task_runs.length > runningTasks.length && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                All Task Runs ({tasks.total})
              </h2>
              <div className="space-y-3">
                {tasks.task_runs
                  .filter((t) => {
                    const s = t.status.toLowerCase();
                    return s !== "running" && s !== "in_progress";
                  })
                  .map((task) => (
                    <TaskRunCard
                      key={`${task.runner_id}-${task.id}`}
                      task={task}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </CollapsiblePanel>
    </TooltipProvider>
  );
}
