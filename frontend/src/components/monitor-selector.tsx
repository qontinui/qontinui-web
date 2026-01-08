"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Monitor } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import type { RunnerMonitor } from "@/lib/schemas/geometry";

interface MonitorSelectorProps {
  monitors?: number[];
  onChange: (monitors: number[]) => void;
  label?: string;
  showLabel?: boolean;
  /** Maximum monitors to show when runner is not connected */
  maxMonitors?: number;
  /** Show runner connection status indicator */
  showConnectionStatus?: boolean;
  /** Optional pre-fetched runner monitors (for performance) */
  runnerMonitors?: RunnerMonitor[];
  /** Whether runner is connected (when using pre-fetched monitors) */
  isRunnerConnected?: boolean;
}

/**
 * Component for selecting and displaying monitor indices.
 * Displays monitors as chips/badges and allows adding/removing monitors.
 * Fetches real monitor info from runner when available.
 */
export function MonitorSelector({
  monitors = [0],
  onChange,
  label = "Hardware Selection",
  showLabel = true,
  maxMonitors = 4,
  showConnectionStatus = true,
  runnerMonitors: externalRunnerMonitors,
  isRunnerConnected: externalIsConnected,
}: MonitorSelectorProps) {
  // Use external monitors if provided, otherwise fetch from hook
  const hookResult = useRunnerMonitors({
    enabled: externalRunnerMonitors === undefined,
  });

  const runnerMonitors = externalRunnerMonitors ?? hookResult.monitors;
  const isRunnerConnected = externalIsConnected ?? hookResult.isRunnerConnected;

  // Get available monitor indices from runner data or fallback to maxMonitors
  const availableMonitors = isRunnerConnected
    ? runnerMonitors.map((m) => m.index)
    : Array.from({ length: maxMonitors }, (_, i) => i);

  // Sort monitors by x position if available (runner data)
  const sortedMonitorIndices = isRunnerConnected
    ? [...runnerMonitors].sort((a, b) => a.x - b.x).map((m) => m.index)
    : availableMonitors;

  const toggleMonitor = (monitorIndex: number) => {
    if (monitors.includes(monitorIndex)) {
      // Allow unselecting provided at least one remains or empty state is allowed (prop check?)
      // Current behavior: allow empty list in UI, let parent validate
      onChange(
        monitors.filter((m) => m !== monitorIndex).sort((a, b) => a - b)
      );
    } else {
      onChange([...monitors, monitorIndex].sort((a, b) => a - b));
    }
  };

  const isAllSelected =
    availableMonitors.length > 0 &&
    monitors.length === availableMonitors.length;

  const toggleAll = () => {
    if (isAllSelected) {
      onChange([]);
    } else {
      onChange([...availableMonitors]);
    }
  };

  const getMonitorSize = (index: number): string => {
    const monitor = runnerMonitors.find((m) => m.index === index);
    if (monitor && isRunnerConnected) {
      return `${monitor.width}×${monitor.height}`;
    }
    return "1920×1080 (Default)";
  };

  return (
    <div className="space-y-4">
      {showLabel && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label className="text-brand-secondary text-lg font-mono">
              {label}
            </Label>
            <p className="text-sm text-text-muted font-mono">
              Select the physical display for automation execution
            </p>
          </div>
          {availableMonitors.length > 1 && (
            <button
              onClick={toggleAll}
              className="text-xs text-brand-primary hover:text-brand-primary/80 font-mono underline opacity-70 hover:opacity-100 transition-opacity"
            >
              {isAllSelected ? "Deselect All" : "Select All"}
            </button>
          )}
        </div>
      )}

      {/* Connection warning if needed, though simpler is better per v0 design */}
      {!isRunnerConnected && showConnectionStatus && (
        <div className="text-xs text-amber-500 font-mono bg-amber-500/10 p-2 rounded border border-amber-500/20">
          Runner disconnected. Using default configuration.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {sortedMonitorIndices.map((monitorIndex) => {
          const isSelected = monitors.includes(monitorIndex);
          const monitorData = runnerMonitors.find(
            (m) => m.index === monitorIndex
          );
          const isPrimary = monitorData?.is_primary;

          return (
            <button
              key={monitorIndex}
              onClick={() => toggleMonitor(monitorIndex)}
              className={`
                relative p-4 rounded-lg border-2 transition-all h-32 flex flex-col items-center justify-center gap-3
                ${
                  isSelected
                    ? "border-brand-secondary bg-brand-secondary/20 shadow-[0_0_30px_rgba(189,0,255,0.4)]"
                    : "border-brand-secondary/20 bg-surface-canvas/50 hover:border-brand-secondary/50 hover:bg-brand-secondary/10"
                }
              `}
            >
              <Monitor
                className={`w-8 h-8 ${isSelected ? "text-brand-secondary" : "text-brand-secondary/60"}`}
              />
              <div className="text-center">
                <div
                  className={`font-semibold text-sm ${isSelected ? "text-brand-secondary" : "text-white"}`}
                >
                  {isPrimary
                    ? `Primary Display [${monitorIndex}]`
                    : `Display ${monitorIndex}`}
                </div>
                <div className="text-xs text-text-muted font-mono mt-1">
                  {getMonitorSize(monitorIndex)}
                </div>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <div className="w-2 h-2 bg-brand-success rounded-full shadow-[0_0_10px_rgba(0,255,136,0.8)] animate-pulse" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {monitors.length === 0 && (
        <div className="text-xs text-destructive animate-pulse font-mono flex items-center gap-2 justify-center">
          <span className="w-2 h-2 bg-destructive rounded-full" />
          NO HARDWARE SELECTED
        </div>
      )}
    </div>
  );
}

/**
 * Compact display component for showing monitors in read-only contexts
 * Uses real monitor info from runner when available.
 */
export function MonitorDisplay({
  monitors = [0],
  className = "",
  runnerMonitors: externalRunnerMonitors,
  isRunnerConnected: externalIsConnected,
}: {
  monitors?: number[];
  className?: string;
  /** Optional pre-fetched runner monitors (for performance) */
  runnerMonitors?: RunnerMonitor[];
  /** Whether runner is connected (when using pre-fetched monitors) */
  isRunnerConnected?: boolean;
}) {
  // Use external monitors if provided, otherwise fetch from hook
  const hookResult = useRunnerMonitors({
    enabled: externalRunnerMonitors === undefined,
  });

  const runnerMonitorData = externalRunnerMonitors ?? hookResult.monitors;
  const isConnected = externalIsConnected ?? hookResult.isRunnerConnected;

  const getMonitorLabel = (index: number): string => {
    // Use real monitor data if available
    const monitor = runnerMonitorData.find((m) => m.index === index);
    if (monitor && isConnected) {
      return (
        monitor.position.charAt(0).toUpperCase() + monitor.position.slice(1)
      );
    }
    // Fallback labels
    const fallbackLabels: { [key: number]: string } = {
      0: "Primary",
      1: "Left",
      2: "Right",
      3: "Top",
    };
    return fallbackLabels[index] || `Monitor ${index}`;
  };

  const getMonitorTooltip = (index: number): string | undefined => {
    const monitor = runnerMonitorData.find((m) => m.index === index);
    if (monitor && isConnected) {
      return monitor.description;
    }
    return undefined;
  };

  return (
    <TooltipProvider>
      <div className={`flex flex-wrap gap-1 ${className}`}>
        {monitors.map((monitorIndex) => {
          const tooltip = getMonitorTooltip(monitorIndex);
          const badge = (
            <Badge
              key={monitorIndex}
              variant="secondary"
              className="bg-surface-raised/50 text-text-secondary border-border-default flex items-center gap-1 px-1.5 py-0.5"
            >
              <Monitor className="w-2.5 h-2.5" />
              <span className="text-[10px]">
                [{monitorIndex}] {getMonitorLabel(monitorIndex)}
              </span>
            </Badge>
          );

          if (tooltip) {
            return (
              <Tooltip key={monitorIndex}>
                <TooltipTrigger asChild>{badge}</TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
              </Tooltip>
            );
          }
          return badge;
        })}
      </div>
    </TooltipProvider>
  );
}
