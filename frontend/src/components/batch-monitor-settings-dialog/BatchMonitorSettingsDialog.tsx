"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Monitor } from "lucide-react";
import { useBatchMonitorSettings } from "./_hooks/useBatchMonitorSettings";
import { MonitorDistribution } from "./_components/MonitorDistribution";
import { BatchOperationsPanel } from "./_components/BatchOperationsPanel";
import { StateMonitorList } from "./_components/StateMonitorList";
import { ChangesSummary } from "./_components/ChangesSummary";
import type { BatchMonitorSettingsDialogProps } from "./types";

export function BatchMonitorSettingsDialog({
  open,
  onOpenChange,
  states,
  onApplyMonitors,
}: BatchMonitorSettingsDialogProps) {
  const {
    stateMonitors,
    modifiedStates,
    selectedStates,
    bulkMonitors,
    setBulkMonitors,
    runnerMonitors,
    isRunnerConnected,
    availableMonitorIndices,
    monitorDistribution,
    handleStateMonitorsChange,
    handleApplyToAll,
    handleResetAll,
    handleToggleState,
    handleSelectAll,
    handleSelectNone,
    handleAddMonitorToSelected,
    handleRemoveMonitorFromSelected,
    getMonitorLabel,
    handleApply,
  } = useBatchMonitorSettings(open, states, onApplyMonitors, onOpenChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[700px] bg-surface-canvas border-border-subtle"
        data-ui-id="dialog-batch-monitor-settings"
      >
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
          <MonitorDistribution monitorDistribution={monitorDistribution} />

          <BatchOperationsPanel
            selectedStatesCount={selectedStates.size}
            availableMonitorIndices={availableMonitorIndices}
            bulkMonitors={bulkMonitors}
            setBulkMonitors={setBulkMonitors}
            runnerMonitors={runnerMonitors}
            isRunnerConnected={isRunnerConnected}
            getMonitorLabel={getMonitorLabel}
            onSelectAll={handleSelectAll}
            onSelectNone={handleSelectNone}
            onResetAll={handleResetAll}
            onAddMonitorToSelected={handleAddMonitorToSelected}
            onRemoveMonitorFromSelected={handleRemoveMonitorFromSelected}
            onApplyToAll={handleApplyToAll}
          />

          <Separator className="bg-border-subtle" />

          <StateMonitorList
            states={states}
            stateMonitors={stateMonitors}
            modifiedStates={modifiedStates}
            selectedStates={selectedStates}
            runnerMonitors={runnerMonitors}
            isRunnerConnected={isRunnerConnected}
            onToggleState={handleToggleState}
            onStateMonitorsChange={handleStateMonitorsChange}
          />

          <ChangesSummary modifiedCount={modifiedStates.size} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border-default"
            data-ui-id="dialog-batch-monitor-settings-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={modifiedStates.size === 0}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
            data-ui-id="dialog-batch-monitor-settings-confirm-btn"
          >
            Apply {modifiedStates.size} Change(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
