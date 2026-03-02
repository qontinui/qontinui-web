"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Copy,
  RotateCcw,
  Plus,
  Minus,
  CheckSquare,
  Square,
} from "lucide-react";
import type { RunnerMonitor } from "@/lib/schemas/geometry";

interface BatchOperationsPanelProps {
  selectedStatesCount: number;
  availableMonitorIndices: number[];
  bulkMonitors: number[];
  setBulkMonitors: (monitors: number[]) => void;
  runnerMonitors: RunnerMonitor[];
  isRunnerConnected: boolean;
  getMonitorLabel: (index: number) => string;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onResetAll: () => void;
  onAddMonitorToSelected: (monitorIndex: number) => void;
  onRemoveMonitorFromSelected: (monitorIndex: number) => void;
  onApplyToAll: () => void;
}

export function BatchOperationsPanel({
  selectedStatesCount,
  availableMonitorIndices,
  bulkMonitors,
  setBulkMonitors,
  runnerMonitors,
  isRunnerConnected,
  getMonitorLabel,
  onSelectAll,
  onSelectNone,
  onResetAll,
  onAddMonitorToSelected,
  onRemoveMonitorFromSelected,
  onApplyToAll,
}: BatchOperationsPanelProps) {
  return (
    <div className="bg-surface-canvas/50 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Batch Operations</Label>
          {selectedStatesCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-purple-900/50 text-purple-300"
            >
              {selectedStatesCount} selected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSelectAll}
            className="h-7 text-xs"
          >
            <CheckSquare className="w-3 h-3 mr-1" />
            Select All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSelectNone}
            className="h-7 text-xs"
          >
            <Square className="w-3 h-3 mr-1" />
            Select None
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onResetAll}
            className="h-7 text-xs text-text-muted hover:text-white"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Select
            onValueChange={(value) => onAddMonitorToSelected(parseInt(value))}
            disabled={selectedStatesCount === 0}
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
              onRemoveMonitorFromSelected(parseInt(value))
            }
            disabled={selectedStatesCount === 0}
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
          {selectedStatesCount === 0
            ? "Select states below first"
            : `to ${selectedStatesCount} selected state(s)`}
        </span>
      </div>

      <Separator className="bg-border-default" />

      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Set All States To:</Label>
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
            onClick={onApplyToAll}
            className="border-brand-primary text-brand-primary hover:bg-brand-primary/10"
          >
            <Copy className="w-3 h-3 mr-1" />
            Apply to All
          </Button>
        </div>
      </div>
    </div>
  );
}
