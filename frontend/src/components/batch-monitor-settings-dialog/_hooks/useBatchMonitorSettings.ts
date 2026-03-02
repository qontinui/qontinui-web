import { useState, useMemo, useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { State } from "@/contexts/automation-context";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";

export function useBatchMonitorSettings(
  open: boolean,
  states: State[],
  onApplyMonitors: (stateIds: string[], monitors: number[]) => Promise<void>,
  onOpenChange: (open: boolean) => void
) {
  const [stateMonitors, setStateMonitors] = useState<Record<string, number[]>>(
    {}
  );
  const [modifiedStates, setModifiedStates] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [bulkMonitors, setBulkMonitors] = useState<number[]>([0]);

  const { monitors: runnerMonitors, isRunnerConnected } = useRunnerMonitors();

  const availableMonitorIndices = useMemo(() => {
    if (isRunnerConnected && runnerMonitors.length > 0) {
      return runnerMonitors.map((m) => m.index);
    }
    return [0, 1, 2, 3];
  }, [runnerMonitors, isRunnerConnected]);

  useEffect(() => {
    if (open) {
      const initial: Record<string, number[]> = {};
      states.forEach((state) => {
        initial[state.id] = state.stateImages?.[0]?.monitors || [0];
      });
      setStateMonitors(initial);
      setModifiedStates(new Set());
      setSelectedStates(new Set());
      setBulkMonitors([0]);
    }
  }, [open, states]);

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

  const handleApplyToAll = useCallback(() => {
    const updated: Record<string, number[]> = {};
    states.forEach((state) => {
      updated[state.id] = [...bulkMonitors];
    });
    setStateMonitors(updated);
    setModifiedStates(new Set(states.map((s) => s.id)));
    toast.success(`Applied monitors to all ${states.length} states`);
  }, [states, bulkMonitors]);

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

  const handleSelectAll = useCallback(() => {
    setSelectedStates(new Set(states.map((s) => s.id)));
  }, [states]);

  const handleSelectNone = useCallback(() => {
    setSelectedStates(new Set());
  }, []);

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

  const handleApply = useCallback(async () => {
    if (modifiedStates.size === 0) {
      toast.error("No changes to apply");
      return;
    }

    try {
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

  return {
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
  };
}
