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
import { useActiveRunner } from "@/contexts/active-runner-context";
import { cn } from "@/lib/utils";

interface RunnerSelectorProps {
  isCollapsed: boolean;
}

function StatusDot({ status }: { status: "connected" | "no-port" | "none" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "no-port" && "bg-amber-400",
        status === "none" && "bg-neutral-400"
      )}
    />
  );
}

function getStatus(runners: Runner[]): "connected" | "no-port" | "none" {
  if (runners.length === 0) return "none";
  if (runners.some((r) => r.port != null)) return "connected";
  return "no-port";
}

export function RunnerSelector({ isCollapsed }: RunnerSelectorProps) {
  const { activeRunner, runners, selectRunner, isMultiRunner } =
    useActiveRunner();

  const status = getStatus(runners);
  const label = activeRunner
    ? (activeRunner.name ?? "Runner")
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
                  status === "connected" && "bg-emerald-500",
                  status === "no-port" && "bg-amber-400",
                  status === "none" && "bg-neutral-400"
                )}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {label}
          {portLabel}
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
        {runners.map((runner) => (
          <DropdownMenuItem
            key={runner.id}
            onClick={() => selectRunner(runner.id)}
            className="flex items-center gap-2"
          >
            <StatusDot status={runner.port != null ? "connected" : "no-port"} />
            <span className="flex-1 truncate text-xs">
              {runner.name}
              {runner.port != null && (
                <span className="ml-1 text-text-subtle">:{runner.port}</span>
              )}
            </span>
            {activeRunner?.id === runner.id && (
              <Check className="size-3 shrink-0 text-text-accent" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
