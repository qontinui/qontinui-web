"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Monitor, Laptop, Terminal, Cpu, Circle } from "lucide-react";
import { relativeTime } from "./utils";
import type { MachineGroup } from "./types";

interface MachineCardProps {
  machine: MachineGroup;
}

function OsIcon({ os }: { os: string }) {
  const lower = os.toLowerCase();
  if (lower === "windows" || lower.startsWith("win")) {
    return <Monitor className="h-4 w-4" />;
  }
  if (lower === "macos" || lower === "darwin") {
    return <Laptop className="h-4 w-4" />;
  }
  if (lower === "linux") {
    return <Terminal className="h-4 w-4" />;
  }
  return <Cpu className="h-4 w-4" />;
}

function osBadgeVariant(os: string): "default" | "secondary" | "outline" {
  const lower = os.toLowerCase();
  if (lower === "windows" || lower.startsWith("win")) return "default";
  if (lower === "macos" || lower === "darwin") return "secondary";
  return "outline";
}

function HealthDot({
  healthy,
  heartbeat,
}: {
  healthy: boolean;
  heartbeat: string | null;
}) {
  const color = healthy ? "text-green-500" : "text-red-500";
  const label = healthy
    ? `Healthy -- last seen ${relativeTime(heartbeat)}`
    : `Unhealthy -- last seen ${relativeTime(heartbeat)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Circle
          className={`h-3 w-3 fill-current ${color}`}
          aria-label={label}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * MachineCard — device-hardware-only after Phase 5 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Renders hostname, OS, runners + their health, and the per-machine
 * Claude Code session list. The "currently editing" + "current
 * activity" sub-lines shipped 2026-05-21 (Phase 1.3 + Phase 4.4 of
 * `coordination-improvements`) have moved to the new `/sessions`
 * panel — same-day ship→delete is intentional per the parent plan
 * ("delete over deprecate").
 *
 * The `MachineGroup` type still carries `currentActivity` and
 * `currentlyEditing` so the join in `FleetOverview` keeps compiling;
 * this component just no longer renders them. Phase 9 cleanup deletes
 * those fields entirely.
 */
export function MachineCard({ machine }: MachineCardProps) {
  const { hostname, runners, claudeSessions } = machine;

  // Determine overall machine health from derivedStatus
  const healthyRunners = runners.filter((r) => r.derivedStatus === "healthy");
  const allHealthy =
    runners.length > 0 && healthyRunners.length === runners.length;
  const someHealthy = healthyRunners.length > 0;

  // Pick OS from first runner
  const os = runners[0]?.os ?? "unknown";
  const osVersion = runners[0]?.osVersion ?? null;

  return (
    <Card
      className="gap-3 py-4 transition-shadow"
      data-operations-machine-card
      data-hostname={hostname}
    >
      <CardHeader className="pb-0 py-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                allHealthy
                  ? "bg-green-500"
                  : someHealthy
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
            />
            <CardTitle className="text-base">{hostname}</CardTitle>
          </div>

          <Badge variant={osBadgeVariant(os)} className="gap-1">
            <OsIcon os={os} />
            {os}
            {osVersion ? ` ${osVersion}` : ""}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-0">
        {/* Runner instances */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Runners ({runners.length})
          </h4>
          <div className="space-y-1.5">
            {runners.map((runner) => {
              const isHealthy = runner.derivedStatus === "healthy";
              return (
                <div
                  key={runner.id}
                  className="flex items-center justify-between text-sm px-2 py-1.5 rounded-md bg-muted/40"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HealthDot
                      healthy={isHealthy}
                      heartbeat={runner.lastHeartbeat ?? null}
                    />
                    {runner.port ? (
                      <span className="font-mono text-xs">:{runner.port}</span>
                    ) : null}
                    <span className="text-muted-foreground text-xs truncate">
                      {runner.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {runner.derivedStatus}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {relativeTime(runner.lastHeartbeat ?? null)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Claude Code sessions */}
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
            Claude Code Sessions ({claudeSessions.length})
          </h4>
          {claudeSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">
              No active sessions
            </p>
          ) : (
            <div className="space-y-1">
              {claudeSessions.map((session) => (
                <div
                  key={session.pid}
                  className="flex items-center justify-between text-xs px-2 py-1 rounded-md bg-muted/40"
                >
                  <span className="font-mono">PID {session.pid}</span>
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    {session.working_directory
                      ? session.working_directory
                          .split(/[/\\]/)
                          .slice(-2)
                          .join("/")
                      : "--"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary footer */}
        <div className="flex items-center gap-3 pt-1 border-t border-border text-xs text-muted-foreground">
          <span>
            {healthyRunners.length} of {runners.length} healthy
          </span>
          <span>
            {claudeSessions.length} CC session
            {claudeSessions.length !== 1 ? "s" : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
