"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAutomation } from "@/contexts/automation-context";
import { createLogger } from "@/lib/logger";

const log = createLogger("useGraphWorkflowBuilder");
import { Workflow, Action, ActionType } from "@/lib/action-schema/action-types";
import { toast } from "sonner";

export function useGraphWorkflowBuilder() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(
    null
  );
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [workflowList, setWorkflowList] = useState<Workflow[]>([]);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);

  const { workflows, addWorkflow, updateWorkflow, deleteWorkflow } =
    useAutomation();

  useEffect(() => {
    setWorkflowList(workflows);

    if (workflows.length > 0 && !selectedWorkflow) {
      setSelectedWorkflow(workflows[0] ?? null);
    }
  }, [workflows, selectedWorkflow]);

  const handleWorkflowChange = useCallback(
    (updatedWorkflow: Workflow) => {
      const workflowWithTimestamp = {
        ...updatedWorkflow,
        metadata: {
          ...updatedWorkflow.metadata,
          modified: new Date().toISOString(),
        },
      };

      updateWorkflow(workflowWithTimestamp);
      setSelectedWorkflow(workflowWithTimestamp);
    },
    [updateWorkflow]
  );

  const handleCreateWorkflow = useCallback(() => {
    const newWorkflow: Workflow = {
      id: `workflow-${Date.now()}`,
      name: "New Workflow",
      version: "1.0.0",
      format: "graph",
      actions: [],
      connections: {},
      metadata: {
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        version: "1.0.0",
      },
    };

    addWorkflow(newWorkflow);
    setSelectedWorkflow(newWorkflow);

    toast.success("Workflow created", {
      description: "New graph workflow created successfully.",
    });
  }, [addWorkflow]);

  const handleNodeClick = useCallback((action: Action) => {
    setSelectedAction(action);
  }, []);

  const handleNodeAdd = useCallback(
    (nodeType: ActionType) => {
      log.debug("handleNodeAdd called with:", nodeType);

      if (!selectedWorkflow) {
        console.error("[GraphWorkflowBuilder] No workflow selected!");
        return;
      }

      const newAction: Action = {
        id: `action-${Date.now()}`,
        type: nodeType,
        config: {},
        position: [100, 100],
      };

      log.debug("Created new action:", newAction.id);

      const updatedWorkflow: Workflow = {
        ...selectedWorkflow,
        actions: [...selectedWorkflow.actions, newAction],
        metadata: {
          ...selectedWorkflow.metadata,
          modified: new Date().toISOString(),
        },
      };

      log.debug(
        "Updated workflow actions count:",
        updatedWorkflow.actions.length
      );

      handleWorkflowChange(updatedWorkflow);

      toast.success("Node added", {
        description: `${nodeType} node added to canvas`,
      });
    },
    [selectedWorkflow, handleWorkflowChange]
  );

  const handleUpdateAction = useCallback(
    (updatedAction: Action) => {
      if (!selectedWorkflow) return;

      const updatedWorkflow: Workflow = {
        ...selectedWorkflow,
        actions: selectedWorkflow.actions.map((a) =>
          a.id === updatedAction.id ? updatedAction : a
        ),
        metadata: {
          ...selectedWorkflow.metadata,
          modified: new Date().toISOString(),
        },
      };

      handleWorkflowChange(updatedWorkflow);
    },
    [selectedWorkflow, handleWorkflowChange]
  );

  const handleDeleteWorkflow = useCallback(
    (workflowId: string) => {
      if (!confirm("Delete this workflow? This action cannot be undone.")) {
        return;
      }

      deleteWorkflow(workflowId);

      if (selectedWorkflow?.id === workflowId) {
        const remainingWorkflows = workflowList.filter(
          (w) => w.id !== workflowId
        );
        setSelectedWorkflow(remainingWorkflows[0] || null);
        setSelectedAction(null);
      }

      toast.success("Workflow deleted");
    },
    [workflowList, selectedWorkflow, deleteWorkflow]
  );

  const handleRenameWorkflow = useCallback(() => {
    if (!selectedWorkflow || !tempName.trim()) {
      setIsEditingName(false);
      return;
    }

    const updatedWorkflow = { ...selectedWorkflow, name: tempName.trim() };

    updateWorkflow(updatedWorkflow);
    setSelectedWorkflow(updatedWorkflow);
    setIsEditingName(false);

    toast.success("Workflow renamed");
  }, [selectedWorkflow, tempName, updateWorkflow]);

  const handleExportWorkflow = useCallback(() => {
    if (!selectedWorkflow) return;

    const json = JSON.stringify(selectedWorkflow, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedWorkflow.name.replace(/\s+/g, "_")}.json`;
    a.click();

    URL.revokeObjectURL(url);

    toast.success("Workflow exported");
  }, [selectedWorkflow]);

  const handleImportWorkflow = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const workflow = JSON.parse(text) as Workflow;

        if (!workflow.id || !workflow.name || !workflow.format) {
          throw new Error("Invalid workflow file");
        }

        if (workflow.format !== "graph") {
          toast.error("Import failed", {
            description: "Only graph format workflows can be imported here.",
          });
          return;
        }

        addWorkflow(workflow);
        setSelectedWorkflow(workflow);

        toast.success("Workflow imported");
      } catch (error) {
        toast.error("Import failed", {
          description:
            error instanceof Error ? error.message : "Invalid JSON file",
        });
      }
    };

    input.click();
  }, [addWorkflow]);

  const selectWorkflow = useCallback((workflow: Workflow) => {
    setSelectedWorkflow(workflow);
    setSelectedAction(null);
  }, []);

  const startEditingName = useCallback(() => {
    if (selectedWorkflow) {
      setTempName(selectedWorkflow.name);
      setIsEditingName(true);
    }
  }, [selectedWorkflow]);

  const cancelEditingName = useCallback(() => {
    setIsEditingName(false);
  }, []);

  return {
    selectedWorkflow,
    selectedAction,
    workflowList,
    isEditingName,
    tempName,
    setTempName,
    canvasRef,
    handleCreateWorkflow,
    handleWorkflowChange,
    handleNodeClick,
    handleNodeAdd,
    handleUpdateAction,
    handleDeleteWorkflow,
    handleRenameWorkflow,
    handleExportWorkflow,
    handleImportWorkflow,
    selectWorkflow,
    startEditingName,
    cancelEditingName,
  };
}

export type GraphWorkflowBuilderState = ReturnType<
  typeof useGraphWorkflowBuilder
>;
