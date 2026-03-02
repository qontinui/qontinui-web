"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import { toast } from "sonner";
import type {
  Workflow,
  Action,
  ActionType,
} from "@/lib/action-schema/action-types";
import { getDefaultConfig } from "@/lib/action-schema/default-configs";
import type { PermissionLevel } from "@/types/collaboration";
import type { ProjectValidationResult } from "@/lib/project-validator";
import { validateProject } from "@/lib/project-validator";
import { createLogger } from "@/lib/logger";
import { runnerClient } from "@/lib/runner-client";
import {
  BuilderMode,
  LibraryItem,
  isLinearWorkflow,
  useItemManagement,
  useModeDetection,
  useFormatConversion,
} from "../index";
import { useProjectSharing } from "./useProjectSharing";

const logger = createLogger("AutomationBuilder");

export function useBuilderState() {
  // Core selection state
  const [mode, setMode] = useState<BuilderMode>("sequential");
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);

  // Dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [projectExportDialogOpen, setProjectExportDialogOpen] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationResults, setValidationResults] =
    useState<ProjectValidationResult | null>(null);

  // Permission state
  const [myPermission, setMyPermission] = useState<PermissionLevel | undefined>(
    undefined
  );

  // Context
  const {
    addWorkflow,
    updateWorkflow,
    states,
    workflows,
    transitions,
    images,
    projectId,
  } = useAutomation();

  // URL params for deep linking
  const searchParams = useSearchParams();
  const initializedFromUrlRef = useRef(false);

  // Hooks
  const { updateItem, deleteItem, deleteItems, createWorkflow } =
    useItemManagement();
  const { handleItemSelection } = useModeDetection({
    currentMode: mode,
    autoSwitch: true,
    onModeChange: setMode,
  });
  const { openConversion, ConversionDialog } = useFormatConversion({
    onModeChange: setMode,
  });
  const {
    collaborators,
    organizations,
    addUser,
    addOrganization,
    changePermission,
    revokeAccess,
    generateShareLink,
    getMyPermission,
  } = useProjectSharing({
    projectId: projectId || null,
    enabled: shareDialogOpen,
  });

  // Load permission when project changes
  useEffect(() => {
    if (projectId) {
      getMyPermission().then(setMyPermission);
    } else {
      setMyPermission(undefined);
    }
  }, [projectId, getMyPermission]);

  // Handle URL parameters for deep linking to workflows
  useEffect(() => {
    if (initializedFromUrlRef.current || workflows.length === 0) {
      return;
    }

    const workflowId = searchParams.get("workflow");
    const modeParam = searchParams.get("mode");

    if (workflowId) {
      const targetWorkflow = workflows.find((w) => w.id === workflowId);
      if (targetWorkflow) {
        initializedFromUrlRef.current = true;
        setSelectedItem(targetWorkflow);

        const isLinear = isLinearWorkflow(targetWorkflow);
        setMode(isLinear ? "sequential" : "graph");

        if (modeParam === "run") {
          toast.info("Workflow loaded for execution", {
            description: `Use the Execute panel or connect to Desktop Runner to run "${targetWorkflow.name}"`,
          });
        }
      } else {
        toast.error("Workflow not found", {
          description: `Could not find workflow with ID "${workflowId}"`,
        });
      }
    }
  }, [workflows, searchParams]);

  // --- Handlers ---

  const handleSelectItem = useCallback(
    (item: LibraryItem) => {
      const canProceed = handleItemSelection(item);
      if (canProceed) {
        setSelectedItem(item);
        setSelectedAction(null);
      }
    },
    [handleItemSelection]
  );

  const handleCreateSequential = useCallback(
    (category: string = "Main") => {
      const newWorkflow = createWorkflow({ viewMode: "sequential", category });
      setSelectedItem(newWorkflow);
      setSelectedAction(null);
      setMode("sequential");
    },
    [createWorkflow]
  );

  const handleCreateGraph = useCallback(
    (category: string = "Main") => {
      const newWorkflow = createWorkflow({ viewMode: "graph", category });
      setSelectedItem(newWorkflow);
      setSelectedAction(null);
      setMode("graph");
    },
    [createWorkflow]
  );

  const handleUpdateWorkflow = useCallback(
    (workflow: Workflow) => {
      logger.debug("handleUpdateWorkflow called:", {
        id: workflow.id,
        name: workflow.name,
        actionsCount: workflow.actions.length,
        actions: workflow.actions.map((a) => ({ id: a.id, type: a.type })),
      });
      updateWorkflow(workflow);
      if (selectedItem?.id === workflow.id) {
        setSelectedItem(workflow);
      }
      logger.debug("handleUpdateWorkflow completed");
    },
    [updateWorkflow, selectedItem]
  );

  const handleUpdateActions = useCallback(
    (actions: Action[]) => {
      if (!selectedItem) return;

      const updatedWorkflow = {
        ...selectedItem,
        actions,
      };
      handleUpdateWorkflow(updatedWorkflow);
    },
    [selectedItem, handleUpdateWorkflow]
  );

  const handleUpdateItem = useCallback(
    (item: LibraryItem) => {
      updateItem(item);
      setSelectedItem(item);
    },
    [updateItem]
  );

  const handleDeleteItem = useCallback(
    (item: LibraryItem) => {
      deleteItem(item);

      if (selectedItem?.id === item.id) {
        setSelectedItem(null);
        setSelectedAction(null);
      }
    },
    [deleteItem, selectedItem]
  );

  const handleDeleteItems = useCallback(
    (items: LibraryItem[]) => {
      deleteItems(items);

      if (selectedItem && items.some((item) => item.id === selectedItem.id)) {
        setSelectedItem(null);
        setSelectedAction(null);
      }
    },
    [deleteItems, selectedItem]
  );

  const handleDuplicateItem = useCallback(() => {
    if (!selectedItem) return;

    const isLinear = isLinearWorkflow(selectedItem);
    const duplicated: Workflow = {
      ...selectedItem,
      id: `workflow-${Date.now()}`,
      name: `${selectedItem.name} (Copy)`,
      metadata: {
        ...selectedItem.metadata,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    addWorkflow(duplicated);
    setSelectedItem(duplicated);
    toast.success(`${isLinear ? "Sequential" : "Graph"} workflow duplicated`, {
      description: `Created "${duplicated.name}"`,
    });
  }, [selectedItem, addWorkflow]);

  const handleSelectAction = useCallback((action: Action | null) => {
    setSelectedAction(action);
  }, []);

  const handleAddNode = useCallback(
    (nodeType: ActionType) => {
      const callId = Date.now();
      logger.debug("handleAddNode called with:", nodeType, "callId:", callId);
      logger.debug("selectedItem:", selectedItem?.id, selectedItem?.name);
      logger.debug("Current actions:", selectedItem?.actions);

      if (!selectedItem) {
        logger.warn("No selectedItem, cannot add node");
        return;
      }

      const newAction: Action = {
        id: `action-${Date.now()}`,
        type: nodeType,
        config: getDefaultConfig(nodeType),
        position: [100, 100],
      };

      logger.debug("Created new action:", newAction);

      const updatedWorkflow = {
        ...selectedItem,
        actions: [...selectedItem.actions, newAction],
      };

      logger.debug(
        "Updated workflow actions count:",
        updatedWorkflow.actions.length
      );
      logger.debug("Calling handleUpdateWorkflow with callId:", callId);
      handleUpdateWorkflow(updatedWorkflow);
      logger.debug("handleUpdateWorkflow completed for callId:", callId);
    },
    [selectedItem, handleUpdateWorkflow]
  );

  const handleUpdateAction = useCallback(
    (updatedAction: Action) => {
      if (!selectedItem) return;

      const updatedActions = selectedItem.actions.map((a: Action) =>
        a.id === updatedAction.id ? updatedAction : a
      );

      handleUpdateActions(updatedActions);
      setSelectedAction(updatedAction);
    },
    [selectedItem, handleUpdateActions]
  );

  const handleShare = useCallback(() => {
    if (!selectedItem) return;
    setShareDialogOpen(true);
  }, [selectedItem]);

  const handleExport = useCallback(() => {
    if (!selectedItem) return;
    setExportDialogOpen(true);
  }, [selectedItem]);

  const handleImport = useCallback(() => {
    setImportDialogOpen(true);
  }, []);

  const handleExportProject = useCallback(() => {
    setProjectExportDialogOpen(true);
  }, []);

  const handleVerifyProject = useCallback(() => {
    const results = validateProject({
      workflows,
      states,
      transitions,
      images,
    });

    setValidationResults(results);
    setValidationDialogOpen(true);
  }, [workflows, states, transitions, images]);

  const handleRun = useCallback(async () => {
    if (!selectedItem) return;

    const isAvailable = await runnerClient.isAvailable();
    if (!isAvailable) {
      toast.error("Desktop Runner not connected", {
        description:
          "Start the qontinui-runner desktop app and ensure it's connected.",
      });
      return;
    }

    const toastId = toast.loading(`Running "${selectedItem.name}"...`, {
      description: "Sending workflow to desktop runner",
    });

    try {
      const result = await runnerClient.runWorkflow(selectedItem.name);

      if (result.success) {
        toast.success(`Workflow "${selectedItem.name}" completed`, {
          id: toastId,
          description: result.execution_time_ms
            ? `Completed in ${(result.execution_time_ms / 1000).toFixed(1)}s`
            : "Execution completed successfully",
        });
      } else {
        toast.error(`Workflow "${selectedItem.name}" failed`, {
          id: toastId,
          description: result.error || "Unknown error occurred",
        });
      }
    } catch (error) {
      toast.error("Failed to run workflow", {
        id: toastId,
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  }, [selectedItem]);

  const handleNavigateToWorkflow = useCallback(
    (workflowId: string) => {
      const workflow = workflows.find((w) => w.id === workflowId);
      if (workflow) {
        setSelectedItem(workflow);
        const isLinear = isLinearWorkflow(workflow);
        setMode(isLinear ? "sequential" : "graph");
        setSelectedAction(null);
      }
    },
    [workflows]
  );

  const handleImportWorkflow = useCallback(
    (workflow: Workflow) => {
      addWorkflow(workflow);
      setSelectedItem(workflow);
      setImportDialogOpen(false);
      toast.success("Workflow imported", {
        description: `Imported "${workflow.name}"`,
      });
    },
    [addWorkflow]
  );

  return {
    // Core state
    mode,
    setMode,
    selectedItem,
    selectedAction,

    // Dialog state
    shareDialogOpen,
    setShareDialogOpen,
    exportDialogOpen,
    setExportDialogOpen,
    importDialogOpen,
    setImportDialogOpen,
    projectExportDialogOpen,
    setProjectExportDialogOpen,
    validationDialogOpen,
    setValidationDialogOpen,
    validationResults,

    // Permission
    myPermission,

    // Context data
    states,

    // Sharing data
    collaborators,
    organizations,
    addUser,
    addOrganization,
    changePermission,
    revokeAccess,
    generateShareLink,

    // Conversion
    openConversion,
    ConversionDialog,

    // Handlers
    handleSelectItem,
    handleCreateSequential,
    handleCreateGraph,
    handleUpdateItem,
    handleDeleteItem,
    handleDeleteItems,
    handleDuplicateItem,
    handleSelectAction,
    handleAddNode,
    handleUpdateAction,
    handleUpdateWorkflow,
    handleUpdateActions,
    handleShare,
    handleExport,
    handleImport,
    handleExportProject,
    handleVerifyProject,
    handleRun,
    handleNavigateToWorkflow,
    handleImportWorkflow,
  };
}
