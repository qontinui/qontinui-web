import { useState, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { Transition } from "../types";

export function useWorkflowManagement(
  transition: Transition,
  processes: Workflow[],
  updateTransition: (updates: Partial<Transition>) => void
) {
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [workflowCategoryFilter, setWorkflowCategoryFilter] =
    useState<string>("Transitions");

  const handleAddWorkflow = (workflowId: string) => {
    const currentWorkflows = transition.workflows || [];
    const alreadyAdded = currentWorkflows.includes(workflowId);

    if (!alreadyAdded) {
      updateTransition({
        workflows: [...currentWorkflows, workflowId],
      });
    }
    setWorkflowDialogOpen(false);
  };

  const handleRemoveWorkflow = (workflowId: string) => {
    const currentWorkflows = transition.workflows || [];
    updateTransition({
      workflows: currentWorkflows.filter((id) => id !== workflowId),
    });
  };

  const handleMoveWorkflowUp = (index: number) => {
    if (index === 0) return;
    const currentWorkflows = [...(transition.workflows || [])];
    const temp = currentWorkflows[index];
    currentWorkflows[index] = currentWorkflows[index - 1]!;
    currentWorkflows[index - 1] = temp!;
    updateTransition({ workflows: currentWorkflows });
  };

  const handleMoveWorkflowDown = (index: number) => {
    const currentWorkflows = transition.workflows || [];
    if (index === currentWorkflows.length - 1) return;
    const newWorkflows = [...currentWorkflows];
    const temp = newWorkflows[index];
    newWorkflows[index] = newWorkflows[index + 1]!;
    newWorkflows[index + 1] = temp!;
    updateTransition({ workflows: newWorkflows });
  };

  const workflowCategories = useMemo(
    () => Array.from(new Set(processes.map((p) => p.category || "Main"))),
    [processes]
  );

  const availableWorkflows = useMemo(() => {
    const filtered = processes.filter((p) => {
      const category = p.category || "Main";
      return (
        workflowCategoryFilter === "All" || category === workflowCategoryFilter
      );
    });
    const currentWorkflows = transition.workflows || [];
    return filtered.filter((p) => !currentWorkflows.includes(p.id));
  }, [processes, workflowCategoryFilter, transition.workflows]);

  return {
    workflowDialogOpen,
    setWorkflowDialogOpen,
    workflowCategoryFilter,
    setWorkflowCategoryFilter,
    handleAddWorkflow,
    handleRemoveWorkflow,
    handleMoveWorkflowUp,
    handleMoveWorkflowDown,
    workflowCategories,
    availableWorkflows,
  };
}
