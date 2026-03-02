import { useState, useCallback } from "react";
import { workflowFileManager } from "../../../../services/workflow-file-manager";
import { workflowFolderManager } from "../../../../services/workflow-folder-manager";
import { toast } from "sonner";
import type { EnhancedWorkflowItem } from "../types";

export function useBulkOperations(
  workflows: EnhancedWorkflowItem[],
  sortedWorkflows: EnhancedWorkflowItem[],
  loadWorkflows: () => Promise<void>
) {
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Set<string>>(
    new Set()
  );

  const handleToggleSelectWorkflow = useCallback(
    (workflowId: string) => {
      const newSet = new Set(selectedWorkflowIds);
      if (newSet.has(workflowId)) {
        newSet.delete(workflowId);
      } else {
        newSet.add(workflowId);
      }
      setSelectedWorkflowIds(newSet);
    },
    [selectedWorkflowIds]
  );

  const handleToggleSelectAll = useCallback(() => {
    if (selectedWorkflowIds.size === sortedWorkflows.length) {
      setSelectedWorkflowIds(new Set());
    } else {
      setSelectedWorkflowIds(
        new Set(sortedWorkflows.map((w) => w.workflow.id))
      );
    }
  }, [selectedWorkflowIds, sortedWorkflows]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedWorkflowIds.size === 0) return;

    if (
      confirm(
        `Delete ${selectedWorkflowIds.size} workflow${selectedWorkflowIds.size !== 1 ? "s" : ""}?`
      )
    ) {
      for (const id of selectedWorkflowIds) {
        const item = workflows.find((w) => w.workflow.id === id);
        if (item) {
          await workflowFileManager.deleteWorkflow(item.key);
        }
      }
      toast.success(`${selectedWorkflowIds.size} workflows deleted`);
      setSelectedWorkflowIds(new Set());
      setBulkSelectMode(false);
      loadWorkflows();
    }
  }, [selectedWorkflowIds, workflows, loadWorkflows]);

  const handleBulkMoveToFolder = useCallback(
    async (folderId: string | null) => {
      if (selectedWorkflowIds.size === 0) return;

      for (const id of selectedWorkflowIds) {
        if (folderId) {
          workflowFolderManager.addWorkflowToFolder(id, folderId);
        } else {
          workflowFolderManager.removeWorkflowFromFolder(id);
        }
      }
      toast.success(`${selectedWorkflowIds.size} workflows moved`);
      setSelectedWorkflowIds(new Set());
      setBulkSelectMode(false);
      loadWorkflows();
    },
    [selectedWorkflowIds, loadWorkflows]
  );

  const handleBulkExport = useCallback(() => {
    if (selectedWorkflowIds.size === 0) return;

    const selectedWorkflows = workflows
      .filter((w) => selectedWorkflowIds.has(w.workflow.id))
      .map((w) => w.workflow);

    const data = JSON.stringify(selectedWorkflows, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflows-export-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Workflows exported");
  }, [selectedWorkflowIds, workflows]);

  const handleToggleBulkSelect = useCallback(() => {
    setBulkSelectMode((prev) => !prev);
    setSelectedWorkflowIds(new Set());
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedWorkflowIds(new Set());
  }, []);

  return {
    bulkSelectMode,
    selectedWorkflowIds,
    handleToggleSelectWorkflow,
    handleToggleSelectAll,
    handleBulkDelete,
    handleBulkMoveToFolder,
    handleBulkExport,
    handleToggleBulkSelect,
    handleClearSelection,
  };
}
