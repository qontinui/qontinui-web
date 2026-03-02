import { useState, useEffect, useMemo } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { useStartScreenshot } from "@/hooks/useStartScreenshot";
import type { SnapshotRun } from "@/types/snapshots";

interface SelectedProcess {
  initialStateIds?: string[];
}

export function useInitialStates(
  selectedSnapshots: SnapshotRun[],
  selectedProcess: SelectedProcess | undefined
) {
  const { states = [] } = useAutomation();
  const [customInitialStates, setCustomInitialStates] = useState<string[]>([]);
  const [useProcessDefaults, setUseProcessDefaults] = useState(true);
  const [useAutoDetectedStates, setUseAutoDetectedStates] = useState(true);

  const firstSnapshotRunId =
    selectedSnapshots.length > 0
      ? (selectedSnapshots[0]?.run_id ?? null)
      : null;
  const { startScreenshot, loading: loadingStartScreenshot } =
    useStartScreenshot(firstSnapshotRunId);

  const effectiveInitialStates = useMemo(() => {
    if (!selectedProcess) return [];

    if (
      useAutoDetectedStates &&
      startScreenshot?.found &&
      startScreenshot.initialStates.length > 0
    ) {
      return startScreenshot.initialStates;
    }

    if (useProcessDefaults) {
      return selectedProcess.initialStateIds || [];
    }

    return customInitialStates;
  }, [
    selectedProcess,
    useProcessDefaults,
    useAutoDetectedStates,
    customInitialStates,
    startScreenshot,
  ]);

  useEffect(() => {
    if (selectedProcess && selectedProcess.initialStateIds) {
      setCustomInitialStates(selectedProcess.initialStateIds);
    }
  }, [selectedProcess]);

  const toggleState = (stateId: string) => {
    setCustomInitialStates((prev) =>
      prev.includes(stateId)
        ? prev.filter((id) => id !== stateId)
        : [...prev, stateId]
    );
  };

  const handleAutoDetectedChange = (checked: boolean) => {
    setUseAutoDetectedStates(checked);
    if (!checked) {
      setUseProcessDefaults(true);
    }
  };

  const handleProcessDefaultsChange = (checked: boolean) => {
    setUseProcessDefaults(checked);
  };

  return {
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
  };
}
