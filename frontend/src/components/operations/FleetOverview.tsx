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
} from "lucide-react";
import { MachineCard } from "./MachineCard";
import { DeviceStatusTile } from "./DeviceStatusTile";
import { TaskRunCard } from "./TaskRunCard";
import { useDeviceStatusStream } from "./useDeviceStatusStream";
import { useSymbolClaimsStream } from "./useSymbolClaimsStream";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_API, POLL_INTERVAL_MS, relativeTime } from "./utils";
import type {
  CiRunnerInfo,
  CiRunnersByHost,
  DeviceStatus,
  FleetStatus,
  AggregatedTaskRuns,
  MachineGroup,
  RunnerTaskRun,
  SymbolClaim,
} from "./types";

// ============================================================================
// Helper: build machine groups from fleet status
// ============================================================================

function buildMachineGroups(
  fleet: FleetStatus,
  deviceStatusByHost: Map<string, DeviceStatus>,
  symbolClaimsByMachine: Map<string, SymbolClaim[]>
): MachineGroup[] {
  const byHost = new Map<string, MachineGroup>();
  const ciRunners: CiRunnersByHost = fleet.ci_runners ?? {};

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

  for (const runner of fleet.runners) {
    const hostname = runner.hostname ?? "unknown";
    let group = byHost.get(hostname);
    if (!group) {
      const activity = deviceStatusByHost.get(hostname);
      group = {
        hostname,
        runners: [],
        claudeSessions: fleet.claude_sessions[hostname] ?? [],
        currentActivity: activity,
        currentlyEditing: resolveClaims(activity),
        ciRunner: resolveCiRunner(hostname),
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
        runners: [],
        claudeSessions: sessions,
        currentActivity: activity,
        currentlyEditing: resolveClaims(activity),
        ciRunner: resolveCiRunner(hostname),
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
        runners: [],
        claudeSessions: [],
        currentActivity,
        currentlyEditing: resolveClaims(currentActivity),
        ciRunner: resolveCiRunner(hostname),
      });
    }
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

export function FleetOverview() {
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [tasks, setTasks] = useState<AggregatedTaskRuns | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [fleetRes, tasksRes] = await Promise.allSettled([
        httpClient.fetch(`${OPERATIONS_API}/fleet`),
        httpClient.fetch(`${OPERATIONS_API}/fleet/tasks`),
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

      setLastUpdated(new Date());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reach operations API"
      );
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

  const machineGroups = useMemo(
    () =>
      fleet
        ? buildMachineGroups(
            fleet,
            deviceStatus.byHostname,
            symbolClaims.byMachine
          )
        : [],
    [fleet, deviceStatus.byHostname, symbolClaims.byMachine]
  );

  const activeCiRunners = useMemo(() => {
    if (!fleet?.ci_runners) return 0;
    return Object.values(fleet.ci_runners).filter(
      (ci) => ci.status !== "offline",
    ).length;
  }, [fleet]);

  const totalCiRunners = useMemo(() => {
    if (!fleet?.ci_runners) return 0;
    return Object.keys(fleet.ci_runners).length;
  }, [fleet]);

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
  if (error && !fleet) {
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

  const isEmpty =
    fleet && fleet.total_runners === 0 && fleet.total_claude_sessions === 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
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
                <MachineCard key={group.hostname} machine={group} />
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
                <TaskRunCard key={`${task.runner_id}-${task.id}`} task={task} />
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
    </TooltipProvider>
  );
}
