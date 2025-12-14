/**
 * useTransitions Hook
 *
 * Hook for transition CRUD operations.
 */

import { useAutomationStore } from "@/stores/automation";

export function useTransitions() {
  // State
  const transitions = useAutomationStore((s) => s.transitions);

  // Actions
  const setTransitions = useAutomationStore((s) => s.setTransitions);
  const addTransition = useAutomationStore((s) => s.addTransition);
  const updateTransition = useAutomationStore((s) => s.updateTransition);
  const deleteTransition = useAutomationStore((s) => s.deleteTransition);

  // Cross-entity helpers (usually called internally)
  const removeStateFromTransitions = useAutomationStore(
    (s) => s.removeStateFromTransitions
  );
  const updateStateReferencesInTransitions = useAutomationStore(
    (s) => s.updateStateReferencesInTransitions
  );

  return {
    transitions,
    setTransitions,
    addTransition,
    updateTransition,
    deleteTransition,
    removeStateFromTransitions,
    updateStateReferencesInTransitions,
  };
}
