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
} from "lucide-react";
import { MachineCard } from "./MachineCard";
import { TaskRunCard } from "./TaskRunCard";
import { OPERATIONS_API, POLL_INTERVAL_MS, relativeTime } from "./utils";
import type {
  FleetStatus,
  AggregatedTaskRuns,
  MachineGroup,
  RunnerTaskRun,
} from "./types";

// ============================================================================
// Helper: build machine groups from fleet status
// ============================================================================

function buildMachineGroups(fleet: FleetStatus): MachineGroup[] {
  const byHost = new Map<string, MachineGroup>();

  for (const runner of fleet.runners) {
    const hostname = runner.hostname ?? "unknown";
    let group = byHost.get(hostname);
    if (!group) {
      group = {
        hostname,
        runners: [],
        claudeSessions: fleet.claude_sessions[hostname] ?? [],
      };
      byHost.set(hostname, group);
    }
    group.runners.push(runner);
  }

  // Also add hostnames that only have Claude sessions (no runner)
  for (const [hostname, sessions] of Object.entries(fleet.claude_sessions)) {
    if (!byHost.has(hostname)) {
      byHost.set(hostname, {
        hostname,
        runners: [],
        claudeSessions: sessions,
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
        fetch(`${OPERATIONS_API}/fleet`),
        fetch(`${OPERATIONS_API}/fleet/tasks`),
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

  const machineGroups = useMemo(
    () => (fleet ? buildMachineGroups(fleet) : []),
    [fleet]
  );

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
  if (error && !fleet) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <WifiOff className="h-12 w-12 opacity-40" />
        <p className="text-lg font-medium">Backend Unreachable</p>
        <p className="text-sm max-w-md text-center">{error}</p>
        <p className="text-xs">
          Make sure the backend is running at{" "}
          <code className="bg-muted px-1 rounded">localhost:8000</code> and the
          operations endpoints are deployed.
        </p>
      </div>
    );
  }

  const isEmpty =
    fleet && fleet.total_runners === 0 && fleet.total_claude_sessions === 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
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
