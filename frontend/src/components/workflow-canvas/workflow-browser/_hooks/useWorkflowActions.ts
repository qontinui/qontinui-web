import { useCallback } from "react";
import { Workflow } from "../../../../lib/action-schema/action-types";
import { workflowFileManager } from "../../../../services/workflow-file-manager";
import { cloneWorkflow } from "../../../../lib/action-schema/workflow-utils";
import { toast } from "sonner";
import type { EnhancedWorkflowItem } from "../types";

export function useWorkflowActions(
  onOpen: (workflow: Workflow) => void,
  onClose: () => void,
  loadWorkflows: () => Promise<void>
) {
  const handleOpenWorkflow = useCallback(
    (item: EnhancedWorkflowItem) => {
      onOpen(item.workflow);
      onClose();
    },
    [onOpen, onClose]
  );

  const handleDuplicateWorkflow = useCallback(
    async (item: EnhancedWorkflowItem) => {
      const duplicated = cloneWorkflow(item.workflow);
      duplicated.name = `${item.workflow.name} (Copy)`;
      await workflowFileManager.saveWorkflow(duplicated);
      toast.success("Workflow duplicated");
      loadWorkflows();
    },
    [loadWorkflows]
  );

  const handleDeleteWorkflow = useCallback(
    async (item: EnhancedWorkflowItem) => {
      if (confirm(`Delete workflow "${item.workflow.name}"?`)) {
        await workflowFileManager.deleteWorkflow(item.key);
        toast.success("Workflow deleted");
        loadWorkflows();
      }
    },
    [loadWorkflows]
  );

  return {
    handleOpenWorkflow,
    handleDuplicateWorkflow,
    handleDeleteWorkflow,
  };
}
