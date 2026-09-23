"use client";

import { Monitor, ChevronDown, Check } from "lucide-react";
import type { Runner } from "@qontinui/shared-types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useActiveRunner,
  type RunnerListState,
} from "@/contexts/active-runner-context";
import type { RunnerLocality } from "@/lib/runner/locality";
import { cn } from "@/lib/utils";

interface RunnerSelectorProps {
  isCollapsed: boolean;
}

/**
 * What a dot shows. Derived from MEASURED locality (does the runner's port on
 * this machine answer with the runner's own id?), never from `port != null`:
 * a listed port says nothing about whether this browser can reach it.
 */
type RunnerDotStatus =
  | RunnerLocality
  | "none"
  | "list_loading"
  | "list_unavailable";

const STATUS_LABEL: Record<RunnerDotStatus, string> = {
  local: "On this machine",
  not_local: "On another machine — not reachable from this browser",
  unknown: "Not confirmed on this machine yet",
  none: "No runner",
  list_loading: "Loading runners",
  list_unavailable: "Runner list unavailable — it could not be loaded",
};

function statusDotClass(status: RunnerDotStatus): string {
  return cn(
    status === "local" && "bg-emerald-500",
    (status === "not_local" || status === "list_unavailable") && "bg-amber-400",
    (status === "unknown" || status === "list_loading") && "bg-neutral-400",
    status === "none" && "bg-neutral-300"
  );
}

function StatusDot({ status }: { status: RunnerDotStatus }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        statusDotClass(status)
      )}
    />
  );
}

/** Dot status of one runner. Not measured yet reads as unknown, never local. */
function getRunnerStatus(
  runner: Runner,
  localityById: ReadonlyMap<string, RunnerLocality>
): RunnerDotStatus {
  return localityById.get(runner.id) ?? "unknown";
}

/** The trigger's dot describes the ACTIVE runner — the one runner calls go to. */
function getStatus(
  activeRunner: Runner | null,
  listState: RunnerListState,
  localityById: ReadonlyMap<string, RunnerLocality>
): RunnerDotStatus {
  // An empty list means "no runner" only once it has actually loaded.
  if (listState === "failed") return "list_unavailable";
  if (listState === "loading") return "list_loading";
  if (activeRunner === null) return "none";
  return getRunnerStatus(activeRunner, localityById);
}

export function RunnerSelector({ isCollapsed }: RunnerSelectorProps) {
  const {
    activeRunner,
    runners,
    selectRunner,
    isMultiRunner,
    listState,
    localityById,
  } = useActiveRunner();

  const status = getStatus(activeRunner, listState, localityById);
  const label = activeRunner
    ? (activeRunner.name ?? "Runner")
    : listState === "failed"
      ? "Runner list unavailable"
      : listState === "loading"
        ? "Loading runners"
        : runners.length === 0
          ? "No runner"
          : "Runner";
  const portLabel = activeRunner?.port ? `:${activeRunner.port}` : "";

  // Collapsed: just show a status dot with tooltip
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover">
            <div className="relative">
              <Monitor className="size-4" />
              <span
                className={cn(
                  "absolute -right-0.5 -top-0.5 size-2 rounded-full border border-surface-canvas",
                  statusDotClass(status)
                )}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {label}
          {portLabel}
          {activeRunner && (
            <span className="block text-text-subtle">
              {STATUS_LABEL[status]}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Expanded: single runner — status + name (no dropdown)
  if (!isMultiRunner) {
    return (
      <div className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-text-muted">
        <StatusDot status={status} />
        <span className="truncate text-xs">
          {label}
          {portLabel && (
            <span className="ml-1 text-text-subtle">{portLabel}</span>
          )}
        </span>
      </div>
    );
  }

  // Expanded: multiple runners — dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary">
          <StatusDot status={status} />
          <span className="flex-1 truncate text-left text-xs">
            {label}
            {portLabel && (
              <span className="ml-1 text-text-subtle">{portLabel}</span>
            )}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        {runners.map((runner) => {
          const runnerStatus = getRunnerStatus(runner, localityById);
          return (
            <DropdownMenuItem
              key={runner.id}
              onClick={() => selectRunner(runner.id)}
              className="flex items-center gap-2"
            >
              <StatusDot status={runnerStatus} />
              <span className="flex-1 truncate text-xs">
                {runner.name}
                {runner.port != null && (
                  <span className="ml-1 text-text-subtle">:{runner.port}</span>
                )}
                {runnerStatus !== "local" && (
                  <span className="block truncate text-text-subtle">
                    {runnerStatus === "not_local"
                      ? "on another machine"
                      : "not confirmed on this machine"}
                  </span>
                )}
              </span>
              {activeRunner?.id === runner.id && (
                <Check className="size-3 shrink-0 text-text-accent" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
