/**
 * useWorkflows Hook
 *
 * Hook for workflow CRUD operations.
 */

import { useAutomationStore } from "@/stores/automation";

export function useWorkflows() {
  // State
  const workflows = useAutomationStore((s) => s.workflows);

  // Actions
  const setWorkflows = useAutomationStore((s) => s.setWorkflows);
  const addWorkflow = useAutomationStore((s) => s.addWorkflow);
  const updateWorkflow = useAutomationStore((s) => s.updateWorkflow);
  const deleteWorkflow = useAutomationStore((s) => s.deleteWorkflow);

  return {
    workflows,
    setWorkflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
  };
}
