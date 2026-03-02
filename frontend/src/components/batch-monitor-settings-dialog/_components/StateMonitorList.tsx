"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { MonitorSelector } from "@/components/monitor-selector";
import { AlertCircle } from "lucide-react";
import type { State } from "@/contexts/automation-context";
import type { RunnerMonitor } from "@/lib/schemas/geometry";

interface StateMonitorListProps {
  states: State[];
  stateMonitors: Record<string, number[]>;
  modifiedStates: Set<string>;
  selectedStates: Set<string>;
  runnerMonitors: RunnerMonitor[];
  isRunnerConnected: boolean;
  onToggleState: (stateId: string) => void;
  onStateMonitorsChange: (stateId: string, monitors: number[]) => void;
}

export function StateMonitorList({
  states,
  stateMonitors,
  modifiedStates,
  selectedStates,
  runnerMonitors,
  isRunnerConnected,
  onToggleState,
  onStateMonitorsChange,
}: StateMonitorListProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          Per-State Monitor Assignment
        </Label>
        <div className="flex items-center gap-2">
          {selectedStates.size > 0 && (
            <Badge
              variant="secondary"
              className="bg-purple-900/50 text-purple-300"
            >
              {selectedStates.size} selected
            </Badge>
          )}
          {modifiedStates.size > 0 && (
            <Badge variant="secondary" className="bg-blue-900/50 text-blue-300">
              {modifiedStates.size} modified
            </Badge>
          )}
        </div>
      </div>

      {states.length === 0 ? (
        <div className="flex items-center gap-2 p-4 bg-status-warning/10 border border-status-warning/50 rounded-lg">
          <AlertCircle className="w-4 h-4 text-yellow-500" />
          <span className="text-sm text-yellow-400">
            No states available. Create states first.
          </span>
        </div>
      ) : (
        <ScrollArea className="h-[300px] border border-border-subtle rounded-lg">
          <div className="p-2 space-y-2">
            {states.map((state) => {
              const monitors = stateMonitors[state.id] || [0];
              const imageCount = state.stateImages?.length || 0;
              const isModified = modifiedStates.has(state.id);
              const isSelected = selectedStates.has(state.id);

              return (
                <div
                  key={state.id}
                  className={`p-3 rounded-lg transition-colors ${
                    isSelected
                      ? "bg-purple-950/20 border border-purple-800/50"
                      : isModified
                        ? "bg-blue-950/20 border border-blue-800/50"
                        : "bg-surface-canvas/50 border border-border-subtle"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="pt-0.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleState(state.id)}
                        className="border-border-default data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                      />
                    </div>

                    <div className="flex-shrink-0 min-w-[120px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-secondary truncate">
                          {state.name}
                        </span>
                        {state.initial && (
                          <Badge
                            variant="outline"
                            className="text-xs border-green-600 text-green-400"
                          >
                            Initial
                          </Badge>
                        )}
                        {isModified && (
                          <Badge
                            variant="secondary"
                            className="text-xs bg-blue-900/50 text-blue-300"
                          >
                            Modified
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-text-muted">
                        {imageCount} screen image(s)
                      </span>
                    </div>

                    <div className="flex-1">
                      <MonitorSelector
                        monitors={monitors}
                        onChange={(newMonitors) =>
                          onStateMonitorsChange(state.id, newMonitors)
                        }
                        showLabel={false}
                        maxMonitors={4}
                        showConnectionStatus={false}
                        runnerMonitors={runnerMonitors}
                        isRunnerConnected={isRunnerConnected}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
