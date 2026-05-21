"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Monitor,
  Laptop,
  Terminal,
  Cpu,
  Circle,
  Activity,
  FileCode2,
} from "lucide-react";
import { extractSymbol, relativeTime, SYMBOL_CLAIMS_TOP_N } from "./utils";
import type { DeviceStatus, MachineGroup, SymbolClaim } from "./types";

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

/**
 * Sub-line rendered just under the machine header showing what the
 * machine is doing right now (Phase 1.3 of
 * `2026-05-21-coordination-improvements.md`).
 *
 * Joins on the `coord.device_status` row whose hostname matches this
 * `MachineGroup`. Format:
 *
 *     <task name> · <repo>/<branch> · phase X/Y · <age>s ago
 *
 * Each segment is omitted when its source field is absent — a row
 * with only `current_task` set renders just "<task name> · <age>s ago".
 * Subtle text-muted-foreground styling matches the existing summary
 * footer and runner-row metadata.
 */
function CurrentActivityLine({ activity }: { activity: DeviceStatus }) {
  const segments: string[] = [];

  if (activity.current_task) {
    segments.push(activity.current_task);
  }

  if (activity.current_repo && activity.current_branch) {
    segments.push(`${activity.current_repo}/${activity.current_branch}`);
  } else if (activity.current_repo) {
    segments.push(activity.current_repo);
  } else if (activity.current_branch) {
    segments.push(activity.current_branch);
  }

  // `details.phase` is the convention `/implement-plan` Step 0.5 +
  // Step 0.6 use (plan Phase 1.4). Tolerate either a string ("2/5")
  // or a number+total shape.
  const phase = activity.details?.["phase"];
  if (typeof phase === "string" && phase.length > 0) {
    segments.push(`phase ${phase}`);
  }

  if (segments.length === 0 && !activity.free_text) {
    // Nothing meaningful to show — hide the row entirely. The agent
    // posted to /coord/status but cleared all fields (e.g. on
    // release-time UPSERT, Phase 1.4).
    return null;
  }

  return (
    <div
      className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-muted/30 text-xs"
      data-operations-current-activity
      data-hostname={activity.hostname ?? ""}
    >
      <Activity
        className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5"
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-foreground/90"
          data-operations-current-activity-line
        >
          {segments.join(" · ")}
          {segments.length > 0 && activity.free_text ? " · " : ""}
          {activity.free_text ? (
            <span className="italic text-muted-foreground">
              {activity.free_text}
            </span>
          ) : null}
        </div>
        <span
          className="text-[10px] text-muted-foreground tabular-nums"
          title={new Date(activity.updated_at).toLocaleString()}
        >
          {relativeTime(activity.updated_at)}
        </span>
      </div>
    </div>
  );
}

/**
 * Sub-line rendered just under `CurrentActivityLine` showing which
 * symbols the machine is currently editing. Plan
 * `2026-05-21-coordination-improvements.md` Phase 4.4.
 *
 * Source: `ClaimKind::Symbol` claims from coord's `/coord/claims/list`,
 * joined client-side by `machine_id ↔ DeviceStatus.device_id`. The
 * qontinui-supervisor `symbol_watcher` daemon (Phase 4.1) acquires
 * these on every tree-sitter-detected symbol edit; coord defaults
 * Symbol TTL to 300s.
 *
 * Renders up to `SYMBOL_CLAIMS_TOP_N` symbol names sorted by TTL desc
 * (freshest edit first). Names longer than `SYMBOL_NAME_MAX_LEN` are
 * truncated with an ellipsis. When more than `SYMBOL_CLAIMS_TOP_N`
 * claims are held, appends "+N more".
 */
function CurrentlyEditingLine({ claims }: { claims: SymbolClaim[] }) {
  if (claims.length === 0) return null;
  const visible = claims.slice(0, SYMBOL_CLAIMS_TOP_N);
  const overflow = Math.max(0, claims.length - SYMBOL_CLAIMS_TOP_N);
  const summary = visible.map((c) => extractSymbol(c.resource_key)).join(", ");
  return (
    <div
      className="flex items-start gap-2 px-2 py-1 text-xs text-muted-foreground"
      data-operations-currently-editing
      data-claim-count={claims.length}
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
      <div
        className="flex-1 min-w-0 truncate"
        data-operations-currently-editing-line
      >
        <span className="text-foreground/70">Editing: </span>
        <span className="font-mono">{summary}</span>
        {overflow > 0 ? (
          <span className="text-muted-foreground/80"> · +{overflow} more</span>
        ) : null}
      </div>
    </div>
  );
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

export function MachineCard({ machine }: MachineCardProps) {
  const {
    hostname,
    runners,
    claudeSessions,
    currentActivity,
    currentlyEditing,
  } = machine;

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
        {/* Phase 1.3 — live device-status sub-line. */}
        {currentActivity ? (
          <CurrentActivityLine activity={currentActivity} />
        ) : null}

        {/* Phase 4.4 — live symbol-claims sub-line. */}
        {currentlyEditing && currentlyEditing.length > 0 ? (
          <CurrentlyEditingLine claims={currentlyEditing} />
        ) : null}

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
