"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Monitor, X, Wifi, WifiOff } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import type { RunnerMonitor } from "@/lib/runner-client";

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
  label = "Monitors",
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

  const unselectedMonitors = availableMonitors.filter(
    (m) => !monitors.includes(m)
  );

  const addMonitor = (monitorIndex: number) => {
    if (!monitors.includes(monitorIndex)) {
      onChange([...monitors, monitorIndex].sort((a, b) => a - b));
    }
  };

  const removeMonitor = (monitorIndex: number) => {
    const newMonitors = monitors.filter((m) => m !== monitorIndex);
    // Always keep at least one monitor selected
    if (newMonitors.length === 0) {
      return;
    }
    onChange(newMonitors);
  };

  const getMonitorLabel = (index: number): string => {
    // Use real monitor data if available
    const monitor = runnerMonitors.find((m) => m.index === index);
    if (monitor && isRunnerConnected) {
      // Capitalize position
      return monitor.position.charAt(0).toUpperCase() + monitor.position.slice(1);
    }
    // Fallback labels when runner not connected
    const fallbackLabels: { [key: number]: string } = {
      0: "Primary",
      1: "Left",
      2: "Right",
      3: "Top",
    };
    return fallbackLabels[index] || `Monitor ${index}`;
  };

  const getMonitorTooltip = (index: number): string | undefined => {
    const monitor = runnerMonitors.find((m) => m.index === index);
    if (monitor && isRunnerConnected) {
      return monitor.description;
    }
    return undefined;
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        {showLabel && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-400">{label}</Label>
            {showConnectionStatus && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    {isRunnerConnected ? (
                      <Wifi className="w-3 h-3 text-green-500" />
                    ) : (
                      <WifiOff className="w-3 h-3 text-gray-500" />
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {isRunnerConnected
                    ? `Connected to runner (${runnerMonitors.length} monitors detected)`
                    : "Runner not connected - using default monitors"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          {/* Display selected monitors as badges */}
          {monitors.map((monitorIndex) => {
            const tooltip = getMonitorTooltip(monitorIndex);
            const badge = (
              <Badge
                key={monitorIndex}
                variant="secondary"
                className="bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30 flex items-center gap-1 px-2 py-1"
              >
                <Monitor className="w-3 h-3" />
                <span className="text-xs">
                  [{monitorIndex}] {getMonitorLabel(monitorIndex)}
                </span>
                <button
                  onClick={() => removeMonitor(monitorIndex)}
                  className="ml-1 hover:text-red-400 transition-colors"
                  disabled={monitors.length === 1}
                  title={
                    monitors.length === 1
                      ? "At least one monitor must be selected"
                      : "Remove monitor"
                  }
                >
                  <X className="w-3 h-3" />
                </button>
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

          {/* Add monitor button/dropdown */}
          {unselectedMonitors.length > 0 && (
            <Select onValueChange={(value) => addMonitor(parseInt(value))}>
              <SelectTrigger className="w-[140px] h-7 border-gray-600 bg-gray-800 text-xs">
                <SelectValue placeholder="Add monitor" />
              </SelectTrigger>
              <SelectContent>
                {unselectedMonitors.map((index) => {
                  const tooltip = getMonitorTooltip(index);
                  return (
                    <SelectItem
                      key={index}
                      value={index.toString()}
                      title={tooltip}
                    >
                      <span className="flex items-center gap-2">
                        <Monitor className="w-3 h-3" />
                        [{index}] {getMonitorLabel(index)}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        {monitors.length === 0 && (
          <p className="text-xs text-amber-400 flex items-center gap-1">
            <span>⚠</span>
            <span>At least one monitor must be selected</span>
          </p>
        )}
      </div>
    </TooltipProvider>
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
      return monitor.position.charAt(0).toUpperCase() + monitor.position.slice(1);
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
              className="bg-gray-700/50 text-gray-300 border-gray-600 flex items-center gap-1 px-1.5 py-0.5"
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
