/**
 * useStates Hook
 *
 * Hook for state CRUD and action history operations.
 */

import { useAutomationStore } from "@/stores/automation";

export function useStates() {
  // State
  const states = useAutomationStore((s) => s.states);

  // Actions
  const setStates = useAutomationStore((s) => s.setStates);
  const addState = useAutomationStore((s) => s.addState);
  const updateState = useAutomationStore((s) => s.updateState);
  const updateStateWithIdChange = useAutomationStore(
    (s) => s.updateStateWithIdChange
  );
  const deleteState = useAutomationStore((s) => s.deleteState);
  const batchUpdateStateMonitors = useAutomationStore(
    (s) => s.batchUpdateStateMonitors
  );

  // Action history
  const updateStateImageActionHistory = useAutomationStore(
    (s) => s.updateStateImageActionHistory
  );
  const updateStateLocationActionHistory = useAutomationStore(
    (s) => s.updateStateLocationActionHistory
  );
  const updateStateRegionActionHistory = useAutomationStore(
    (s) => s.updateStateRegionActionHistory
  );

  // RAG
  const applyRAGSetupResults = useAutomationStore(
    (s) => s.applyRAGSetupResults
  );

  return {
    // State
    states,

    // CRUD
    setStates,
    addState,
    updateState,
    updateStateWithIdChange,
    deleteState,
    batchUpdateStateMonitors,

    // Action history
    updateStateImageActionHistory,
    updateStateLocationActionHistory,
    updateStateRegionActionHistory,

    // RAG
    applyRAGSetupResults,
  };
}
