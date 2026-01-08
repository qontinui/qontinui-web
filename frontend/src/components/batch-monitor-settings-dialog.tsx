/**
 * BatchMonitorSettingsDialog Component
 *
 * Allows users to set monitor settings for multiple states at once.
 * Each state can have its own monitor assignment, with bulk operations:
 * - Select states and add/remove monitors
 * - Apply same monitors to all states
 * - Edit individual state monitors
 */

"use client";

import React, { useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonitorSelector } from "@/components/monitor-selector";
import {
  Monitor,
  AlertCircle,
  Copy,
  RotateCcw,
  Plus,
  Minus,
  CheckSquare,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import type { State } from "@/contexts/automation-context";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";

export interface BatchMonitorSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: State[];
  onApplyMonitors: (stateIds: string[], monitors: number[]) => Promise<void>;
}

export function BatchMonitorSettingsDialog({
  open,
  onOpenChange,
  states,
  onApplyMonitors,
}: BatchMonitorSettingsDialogProps) {
  // Track monitors per state (stateId -> monitors array)
  const [stateMonitors, setStateMonitors] = useState<Record<string, number[]>>(
    {}
  );
  // Track which states have been modified
  const [modifiedStates, setModifiedStates] = useState<Set<string>>(new Set());
  // Track which states are selected for batch operations
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  // Bulk apply monitors
  const [bulkMonitors, setBulkMonitors] = useState<number[]>([0]);

  // Fetch runner monitors once for performance
  const { monitors: runnerMonitors, isRunnerConnected } = useRunnerMonitors();

  // Get available monitor indices
  const availableMonitorIndices = useMemo(() => {
    if (isRunnerConnected && runnerMonitors.length > 0) {
      return runnerMonitors.map((m) => m.index);
    }
    return [0, 1, 2, 3]; // Default fallback
  }, [runnerMonitors, isRunnerConnected]);

  // Initialize state monitors from current state data
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, number[]> = {};
      states.forEach((state) => {
        // Get monitors from first stateImage, default to [0]
        initial[state.id] = state.stateImages?.[0]?.monitors || [0];
      });
      setStateMonitors(initial);
      setModifiedStates(new Set());
      setSelectedStates(new Set());
      setBulkMonitors([0]);
    }
  }, [open, states]);

  // Get current monitor distribution
  const monitorDistribution = useMemo(() => {
    const distribution: Record<number, number> = {};
    states.forEach((state) => {
      state.stateImages?.forEach((si) => {
        (si.monitors || [0]).forEach((m) => {
          distribution[m] = (distribution[m] || 0) + 1;
        });
      });
    });
    return distribution;
  }, [states]);

  // Update monitors for a specific state
  const handleStateMonitorsChange = useCallback(
    (stateId: string, monitors: number[]) => {
      setStateMonitors((prev) => ({
        ...prev,
        [stateId]: monitors,
      }));
      setModifiedStates((prev) => new Set([...prev, stateId]));
    },
    []
  );

  // Apply bulk monitors to all states
  const handleApplyToAll = useCallback(() => {
    const updated: Record<string, number[]> = {};
    states.forEach((state) => {
      updated[state.id] = [...bulkMonitors];
    });
    setStateMonitors(updated);
    setModifiedStates(new Set(states.map((s) => s.id)));
    toast.success(`Applied monitors to all ${states.length} states`);
  }, [states, bulkMonitors]);

  // Reset all to original values
  const handleResetAll = useCallback(() => {
    const initial: Record<string, number[]> = {};
    states.forEach((state) => {
      initial[state.id] = state.stateImages?.[0]?.monitors || [0];
    });
    setStateMonitors(initial);
    setModifiedStates(new Set());
    setSelectedStates(new Set());
    toast.info("Reset all monitors to original values");
  }, [states]);

  // Toggle state selection
  const handleToggleState = useCallback((stateId: string) => {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  }, []);

  // Select all states
  const handleSelectAll = useCallback(() => {
    setSelectedStates(new Set(states.map((s) => s.id)));
  }, [states]);

  // Deselect all states
  const handleSelectNone = useCallback(() => {
    setSelectedStates(new Set());
  }, []);

  // Add a monitor to selected states (without removing existing)
  const handleAddMonitorToSelected = useCallback(
    (monitorIndex: number) => {
      if (selectedStates.size === 0) {
        toast.error("Select at least one state first");
        return;
      }

      const updated: Record<string, number[]> = { ...stateMonitors };
      const affectedStates: string[] = [];

      selectedStates.forEach((stateId) => {
        const current = updated[stateId] || [0];
        if (!current.includes(monitorIndex)) {
          updated[stateId] = [...current, monitorIndex].sort((a, b) => a - b);
          affectedStates.push(stateId);
        }
      });

      if (affectedStates.length === 0) {
        toast.info("All selected states already have this monitor");
        return;
      }

      setStateMonitors(updated);
      setModifiedStates((prev) => new Set([...prev, ...affectedStates]));
      toast.success(`Added monitor to ${affectedStates.length} state(s)`);
    },
    [selectedStates, stateMonitors]
  );

  // Remove a monitor from selected states
  const handleRemoveMonitorFromSelected = useCallback(
    (monitorIndex: number) => {
      if (selectedStates.size === 0) {
        toast.error("Select at least one state first");
        return;
      }

      const updated: Record<string, number[]> = { ...stateMonitors };
      const affectedStates: string[] = [];
      let skippedCount = 0;

      selectedStates.forEach((stateId) => {
        const current = updated[stateId] || [0];
        if (current.includes(monitorIndex)) {
          const newMonitors = current.filter((m) => m !== monitorIndex);
          // Don't allow removing the last monitor
          if (newMonitors.length === 0) {
            skippedCount++;
            return;
          }
          updated[stateId] = newMonitors;
          affectedStates.push(stateId);
        }
      });

      if (affectedStates.length === 0 && skippedCount === 0) {
        toast.info("No selected states have this monitor");
        return;
      }

      if (affectedStates.length > 0) {
        setStateMonitors(updated);
        setModifiedStates((prev) => new Set([...prev, ...affectedStates]));
      }

      if (skippedCount > 0) {
        toast.warning(
          `Removed from ${affectedStates.length} state(s), skipped ${skippedCount} (can't remove last monitor)`
        );
      } else {
        toast.success(`Removed monitor from ${affectedStates.length} state(s)`);
      }
    },
    [selectedStates, stateMonitors]
  );

  // Get monitor label helper
  const getMonitorLabel = useCallback(
    (index: number): string => {
      const monitor = runnerMonitors.find((m) => m.index === index);
      if (monitor && isRunnerConnected) {
        return (
          monitor.position.charAt(0).toUpperCase() + monitor.position.slice(1)
        );
      }
      const fallbackLabels: Record<number, string> = {
        0: "Primary",
        1: "Left",
        2: "Right",
        3: "Top",
      };
      return fallbackLabels[index] || `Monitor ${index}`;
    },
    [runnerMonitors, isRunnerConnected]
  );

  // Apply changes
  const handleApply = useCallback(async () => {
    if (modifiedStates.size === 0) {
      toast.error("No changes to apply");
      return;
    }

    try {
      // Apply changes for each modified state
      const updates = Array.from(modifiedStates).map(async (stateId) => {
        const monitors = stateMonitors[stateId];
        if (monitors && monitors.length > 0) {
          await onApplyMonitors([stateId], monitors);
        }
      });
      await Promise.all(updates);

      toast.success(
        `Updated monitor settings for ${modifiedStates.size} state(s)`
      );
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to apply monitor settings");
      console.error("Failed to apply monitor settings:", error);
    }
  }, [modifiedStates, stateMonitors, onApplyMonitors, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] bg-surface-canvas border-border-subtle">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-brand-primary" />
            Batch Monitor Settings
          </DialogTitle>
          <DialogDescription>
            Configure which monitors each state should be detected on. States
            can be assigned to multiple monitors.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Status */}
          <div className="bg-surface-canvas rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-medium text-text-secondary">
              Current Monitor Distribution
            </h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(monitorDistribution).length > 0 ? (
                Object.entries(monitorDistribution)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([monitor, count]) => (
                    <Badge
                      key={monitor}
                      variant="secondary"
                      className="bg-surface-raised"
                    >
                      {monitor === "0"
                        ? "Primary"
                        : monitor === "1"
                          ? "Left"
                          : monitor === "2"
                            ? "Right"
                            : `Monitor ${monitor}`}
                      : {count} state image(s)
                    </Badge>
                  ))
              ) : (
                <span className="text-sm text-text-muted">
                  No monitor settings configured yet
                </span>
              )}
            </div>
          </div>

          {/* Batch Operations Section */}
          <div className="bg-surface-canvas/50 rounded-lg p-4 space-y-4">
            {/* Selection Controls */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Batch Operations</Label>
                {selectedStates.size > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-purple-900/50 text-purple-300"
                  >
                    {selectedStates.size} selected
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  className="h-7 text-xs"
                >
                  <CheckSquare className="w-3 h-3 mr-1" />
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectNone}
                  className="h-7 text-xs"
                >
                  <Square className="w-3 h-3 mr-1" />
                  Select None
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetAll}
                  className="h-7 text-xs text-text-muted hover:text-white"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
              </div>
            </div>

            {/* Add/Remove Monitor to Selected */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Select
                  onValueChange={(value) =>
                    handleAddMonitorToSelected(parseInt(value))
                  }
                  disabled={selectedStates.size === 0}
                >
                  <SelectTrigger className="w-[160px] h-8 border-green-700 bg-green-950/30 text-green-300 text-xs">
                    <Plus className="w-3 h-3 mr-1" />
                    <SelectValue placeholder="Add monitor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMonitorIndices.map((index) => (
                      <SelectItem key={index} value={index.toString()}>
                        <span className="flex items-center gap-2">
                          <Monitor className="w-3 h-3" />[{index}]{" "}
                          {getMonitorLabel(index)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  onValueChange={(value) =>
                    handleRemoveMonitorFromSelected(parseInt(value))
                  }
                  disabled={selectedStates.size === 0}
                >
                  <SelectTrigger className="w-[180px] h-8 border-red-700 bg-red-950/30 text-red-300 text-xs">
                    <Minus className="w-3 h-3 mr-1" />
                    <SelectValue placeholder="Remove monitor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMonitorIndices.map((index) => (
                      <SelectItem key={index} value={index.toString()}>
                        <span className="flex items-center gap-2">
                          <Monitor className="w-3 h-3" />[{index}]{" "}
                          {getMonitorLabel(index)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <span className="text-xs text-text-muted">
                {selectedStates.size === 0
                  ? "Select states below first"
                  : `to ${selectedStates.size} selected state(s)`}
              </span>
            </div>

            <Separator className="bg-border-default" />

            {/* Quick Set All States */}
            <div className="space-y-2">
              <Label className="text-xs text-text-muted">
                Set All States To:
              </Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <MonitorSelector
                    monitors={bulkMonitors}
                    onChange={setBulkMonitors}
                    showLabel={false}
                    maxMonitors={4}
                    showConnectionStatus={false}
                    runnerMonitors={runnerMonitors}
                    isRunnerConnected={isRunnerConnected}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApplyToAll}
                  className="border-brand-primary text-brand-primary hover:bg-brand-primary/10"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Apply to All
                </Button>
              </div>
            </div>
          </div>

          <Separator className="bg-border-subtle" />

          {/* Per-State Monitor Selection */}
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
                  <Badge
                    variant="secondary"
                    className="bg-blue-900/50 text-blue-300"
                  >
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
                          {/* Selection Checkbox */}
                          <div className="pt-0.5">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                handleToggleState(state.id)
                              }
                              className="border-border-default data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
                            />
                          </div>

                          {/* State Info */}
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

                          {/* Monitor Selector */}
                          <div className="flex-1">
                            <MonitorSelector
                              monitors={monitors}
                              onChange={(newMonitors) =>
                                handleStateMonitorsChange(state.id, newMonitors)
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

          {/* Changes Summary */}
          {modifiedStates.size > 0 && (
            <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-400">
                {modifiedStates.size} state(s) will be updated. Monitor settings
                will be applied to all state images within these states.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border-default"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={modifiedStates.size === 0}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            Apply {modifiedStates.size} Change(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
