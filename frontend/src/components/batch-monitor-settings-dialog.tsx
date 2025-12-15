/**
 * BatchMonitorSettingsDialog Component
 *
 * Allows users to set monitor settings for multiple states at once.
 * Users can select which states to update and which monitors to apply.
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
import { MonitorSelector } from "@/components/monitor-selector";
import { Monitor, CheckSquare, Square, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { State } from "@/contexts/automation-context";

export interface BatchMonitorSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  states: State[];
  onApplyMonitors: (stateIds: string[], monitors: number[]) => void;
}

export function BatchMonitorSettingsDialog({
  open,
  onOpenChange,
  states,
  onApplyMonitors,
}: BatchMonitorSettingsDialogProps) {
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(
    new Set()
  );
  const [monitors, setMonitors] = useState<number[]>([0]);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedStateIds(new Set());
      setMonitors([0]);
    }
  }, [open]);

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

  const handleSelectAll = useCallback(() => {
    setSelectedStateIds(new Set(states.map((s) => s.id)));
  }, [states]);

  const handleSelectNone = useCallback(() => {
    setSelectedStateIds(new Set());
  }, []);

  const handleToggleState = useCallback((stateId: string) => {
    setSelectedStateIds((prev) => {
      const next = new Set(prev);
      if (next.has(stateId)) {
        next.delete(stateId);
      } else {
        next.add(stateId);
      }
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    if (selectedStateIds.size === 0) {
      toast.error("Please select at least one state");
      return;
    }

    if (monitors.length === 0) {
      toast.error("Please select at least one monitor");
      return;
    }

    onApplyMonitors(Array.from(selectedStateIds), monitors);
    toast.success(
      `Applied monitor settings to ${selectedStateIds.size} state(s)`,
      {
        description: `Monitors: ${monitors.map((m) => (m === 0 ? "Primary" : m === 1 ? "Left" : m === 2 ? "Right" : `Monitor ${m}`)).join(", ")}`,
      }
    );
    onOpenChange(false);
  }, [selectedStateIds, monitors, onApplyMonitors, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] bg-gray-950 border-gray-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-[#00D9FF]" />
            Batch Monitor Settings
          </DialogTitle>
          <DialogDescription>
            Apply monitor settings to multiple states at once. This is useful
            for multi-monitor setups where states should be detected on specific
            displays.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Status */}
          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <h4 className="text-sm font-medium text-gray-300">
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
                      className="bg-gray-800"
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
                <span className="text-sm text-gray-500">
                  No monitor settings configured yet
                </span>
              )}
            </div>
          </div>

          {/* Monitor Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Target Monitors</Label>
            <p className="text-xs text-gray-500">
              Select which monitors these states should be detected on
            </p>
            <MonitorSelector
              monitors={monitors}
              onChange={setMonitors}
              maxMonitors={4}
            />
          </div>

          <Separator className="bg-gray-800" />

          {/* State Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Select States</Label>
              <div className="flex gap-2">
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
              </div>
            </div>

            {states.length === 0 ? (
              <div className="flex items-center gap-2 p-4 bg-yellow-950/30 border border-yellow-800 rounded-lg">
                <AlertCircle className="w-4 h-4 text-yellow-500" />
                <span className="text-sm text-yellow-400">
                  No states available. Create states first.
                </span>
              </div>
            ) : (
              <ScrollArea className="h-[250px] border border-gray-800 rounded-lg">
                <div className="p-2 space-y-1">
                  {states.map((state) => {
                    const currentMonitors = state.stateImages?.[0]
                      ?.monitors || [0];
                    const imageCount = state.stateImages?.length || 0;

                    return (
                      <label
                        key={state.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-900 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedStateIds.has(state.id)}
                          onCheckedChange={() => handleToggleState(state.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-200 truncate">
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
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <span>{imageCount} screen image(s)</span>
                            <span>•</span>
                            <span>
                              Monitors:{" "}
                              {currentMonitors
                                .map((m) =>
                                  m === 0
                                    ? "Primary"
                                    : m === 1
                                      ? "Left"
                                      : m === 2
                                        ? "Right"
                                        : `${m}`
                                )
                                .join(", ")}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Selection Summary */}
          {selectedStateIds.size > 0 && (
            <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-3">
              <p className="text-sm text-blue-400">
                {selectedStateIds.size} state(s) selected. Monitor settings will
                be applied to all state images within these states.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-gray-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={selectedStateIds.size === 0 || monitors.length === 0}
            className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
          >
            Apply to {selectedStateIds.size} State(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
