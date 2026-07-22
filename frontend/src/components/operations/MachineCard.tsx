"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Pencil,
  Loader2,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";
import { machineRenameUrl, relativeTime } from "./utils";
import { CiRunnerBadge } from "./CiRunnerBadge";
import type { MachineGroup } from "./types";

interface MachineCardProps {
  machine: MachineGroup;
  /**
   * Called after a successful rename so the parent can re-fetch the fleet
   * payload and reconcile the authoritative `machine_display_names`. Optional —
   * when absent, the optimistic local name + the 10s poll keep the card honest.
   */
  onRenamed?: () => void;
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
export function MachineCard({ machine, onRenamed }: MachineCardProps) {
  const { hostname, displayName, runners, claudeSessions } = machine;

  // The shown title: an operator alias when set, otherwise the raw hostname.
  // Optimistic local override wins while a save is in flight / before the poll
  // reconciles the authoritative `machine_display_names`.
  const [optimisticName, setOptimisticName] = useState<string | null>(null);
  const shownName = optimisticName ?? displayName ?? hostname;

  // Inline-rename state (mirrors PrioritySetsSection's edit UX).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shownName);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against the blur-after-Enter (or blur-after-Escape) double-save.
  const committedRef = useRef(false);

  // A fresh authoritative name (poll reconciled) clears any optimistic override.
  useEffect(() => {
    setOptimisticName(null);
  }, [displayName]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setRenameError(null);
    setDraft(displayName ?? optimisticName ?? hostname);
    committedRef.current = false;
    setEditing(true);
  };

  const cancelEditing = () => {
    committedRef.current = true;
    setEditing(false);
    setRenameError(null);
  };

  const saveRename = async () => {
    if (committedRef.current) return;
    committedRef.current = true;

    // Trimmed empty string clears the alias (reverts to hostname) per contract.
    const next = draft.trim();
    const current = displayName ?? "";
    setEditing(false);

    // No-op when nothing changed (e.g. blur with the title untouched).
    if (next === current) return;

    // Optimistic: an empty next clears back to the hostname.
    setOptimisticName(next === "" ? hostname : next);
    setSaving(true);
    setRenameError(null);

    try {
      const res = await httpClient.fetch(machineRenameUrl(hostname), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      // Re-fetch the fleet so the authoritative name lands; the
      // `displayName`-keyed effect then drops the optimistic override.
      onRenamed?.();
    } catch (err) {
      // Revert the optimistic name and surface a subtle inline error.
      setOptimisticName(null);
      setRenameError(
        err instanceof Error ? err.message : "Failed to rename machine"
      );
    } finally {
      setSaving(false);
    }
  };

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
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                allHealthy
                  ? "bg-green-500"
                  : someHealthy
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
            />
            {editing ? (
              <Input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditing();
                  }
                }}
                placeholder={hostname}
                aria-label={`Rename ${hostname}`}
                className="h-7 text-base"
              />
            ) : (
              <CardTitle className="text-base truncate">{shownName}</CardTitle>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!editing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={startEditing}
                    disabled={saving}
                    aria-label={`Rename ${hostname}`}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Rename machine</TooltipContent>
              </Tooltip>
            )}

            <Badge variant={osBadgeVariant(os)} className="gap-1">
              <OsIcon os={os} />
              {os}
              {osVersion ? ` ${osVersion}` : ""}
            </Badge>
          </div>
        </div>
        {renameError && (
          <p className="text-xs text-destructive mt-1">
            Rename failed: {renameError}
          </p>
        )}
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

        {/* CI Runner */}
        {machine.ciRunner && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              CI Runner
            </h4>
            <CiRunnerBadge ciRunner={machine.ciRunner} />
          </div>
        )}

        {/* Summary footer */}
        <div className="flex items-center gap-3 pt-1 border-t border-border text-xs text-muted-foreground">
          <span>
            {healthyRunners.length} of {runners.length} healthy
          </span>
          <span>
            {claudeSessions.length} CC session
            {claudeSessions.length !== 1 ? "s" : ""}
          </span>
          {machine.ciRunner && machine.ciRunner.status !== "offline" && (
            <span>CI runner active</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
