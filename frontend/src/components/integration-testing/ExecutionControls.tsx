"use client";

import { toast } from "sonner";
import type { SnapshotRun } from "@/types/snapshots";
import { useProcessSelection } from "./_hooks/useProcessSelection";
import { useInitialStates } from "./_hooks/useInitialStates";
import { ProcessSelectionCard } from "./_components/ProcessSelectionCard";
import { InitialStatesCard } from "./_components/InitialStatesCard";
import { ExecutionButtonCard } from "./_components/ExecutionButtonCard";
import { SnapshotInfoCard } from "./_components/SnapshotInfoCard";

interface ExecutionControlsProps {
  selectedSnapshots: SnapshotRun[];
  onExecute?: (
    processId: string,
    initialStates: string[],
    snapshotRunIds: string[]
  ) => void;
  onStop?: () => void;
  isExecuting?: boolean;
  onProcessChange?: (processId: string) => void;
}

export function ExecutionControls({
  selectedSnapshots,
  onExecute,
  onStop,
  isExecuting = false,
  onProcessChange,
}: ExecutionControlsProps) {
  const {
    selectedCategory,
    selectedProcessId,
    processesByCategory,
    categoryProcesses,
    selectedProcess,
    handleCategoryChange,
    handleProcessChange,
  } = useProcessSelection(onProcessChange);

  const {
    states,
    customInitialStates,
    useProcessDefaults,
    useAutoDetectedStates,
    effectiveInitialStates,
    startScreenshot,
    loadingStartScreenshot,
    toggleState,
    handleAutoDetectedChange,
    handleProcessDefaultsChange,
  } = useInitialStates(selectedSnapshots, selectedProcess);

  const handleExecute = () => {
    if (!selectedProcess) {
      toast.error("No workflow selected", {
        description: "Please select a workflow to execute",
      });
      return;
    }

    if (!selectedSnapshots || selectedSnapshots.length === 0) {
      toast.error("No snapshots selected", {
        description:
          "Please select at least one snapshot run for integration testing",
      });
      return;
    }

    if (effectiveInitialStates.length === 0) {
      toast.error("No initial states", {
        description: "Please select at least one initial state",
      });
      return;
    }

    const snapshotRunIds = selectedSnapshots.map((s) => s.run_id);

    if (onExecute) {
      onExecute(selectedProcess.id, effectiveInitialStates, snapshotRunIds);
    }
  };

  return (
    <div className="space-y-4">
      <ProcessSelectionCard
        selectedCategory={selectedCategory}
        selectedProcessId={selectedProcessId}
        processesByCategory={processesByCategory}
        categoryProcesses={categoryProcesses}
        selectedProcess={selectedProcess}
        onCategoryChange={handleCategoryChange}
        onProcessChange={handleProcessChange}
        isExecuting={isExecuting}
      />

      {selectedProcess && (
        <InitialStatesCard
          selectedProcess={selectedProcess}
          states={states}
          customInitialStates={customInitialStates}
          useProcessDefaults={useProcessDefaults}
          useAutoDetectedStates={useAutoDetectedStates}
          effectiveInitialStates={effectiveInitialStates}
          startScreenshot={startScreenshot}
          loadingStartScreenshot={loadingStartScreenshot}
          isExecuting={isExecuting}
          onToggleState={toggleState}
          onAutoDetectedChange={handleAutoDetectedChange}
          onProcessDefaultsChange={handleProcessDefaultsChange}
        />
      )}

      <ExecutionButtonCard
        isExecuting={isExecuting}
        disabled={
          !selectedProcess ||
          selectedSnapshots.length === 0 ||
          effectiveInitialStates.length === 0
        }
        onExecute={handleExecute}
        onStop={onStop}
      />

      <SnapshotInfoCard selectedSnapshots={selectedSnapshots} />
    </div>
  );
}
