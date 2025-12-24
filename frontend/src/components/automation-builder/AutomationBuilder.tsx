/**
 * AutomationBuilder - Unified Builder Component
 *
 * Single builder component that handles both sequential processes and graph workflows.
 * Features:
 * - Mode switching (Sequential <-> Graph)
 * - Unified library panel
 * - Automatic format detection
 * - Format conversion support
 * - Three-panel layout (Library | Editor | Properties)
 */

"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { UnifiedProcessLibrary } from "@/components/unified-process-library";
import { ActionProperties } from "@/components/action-properties";
import { useAutomation } from "@/contexts/automation-context";
import { toast } from "sonner";
import type {
  Workflow,
  Action,
  ActionType,
} from "@/lib/action-schema/action-types";
import { getDefaultConfig } from "@/lib/action-schema/default-configs";
import type { PermissionLevel } from "@/types/collaboration";

// Import our new components
import {
  BuilderMode,
  LibraryItem,
  isLinearWorkflow,
  useItemManagement,
  useModeDetection,
  useFormatConversion,
  EmptyState,
  SequentialEditor,
  GraphEditor,
  BuilderModeSelector,
  ItemMetadataPanel,
  EditorToolbar,
} from "./index";
import { ShareProjectDialog } from "./components/ShareProjectDialog";
import { ProjectExportDialog } from "./components/ProjectExportDialog";
import { useProjectSharing } from "./hooks/useProjectSharing";
import {
  ExportDialog,
  ImportDialog,
} from "@/components/workflow-canvas/ImportExportDialog";

export function AutomationBuilder() {
  // State
  const [mode, setMode] = useState<BuilderMode>("sequential");
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [projectExportDialogOpen, setProjectExportDialogOpen] = useState(false);

  // Context
  const { addWorkflow, updateWorkflow, states, workflows } = useAutomation();

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
    projectId: selectedItem?.id || null,
    enabled: shareDialogOpen,
  });

  // Track current user's permission
  const [myPermission, setMyPermission] = useState<PermissionLevel | undefined>(
    undefined
  );

  // Load permission when item changes
  useEffect(() => {
    if (selectedItem?.id) {
      getMyPermission().then(setMyPermission);
    } else {
      setMyPermission(undefined);
    }
  }, [selectedItem?.id, getMyPermission]);

  // Handle URL parameters for deep linking to workflows
  useEffect(() => {
    // Only run once when workflows are loaded and we haven't initialized yet
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

        // Set the editor mode based on the workflow type
        const isLinear = isLinearWorkflow(targetWorkflow);
        setMode(isLinear ? "sequential" : "graph");

        // If mode=run, show a toast indicating run mode
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

  /**
   * Handle item selection from library
   */
  const handleSelectItem = useCallback(
    (item: LibraryItem) => {
      // Check if item is compatible with current mode, auto-switch if needed
      const canProceed = handleItemSelection(item);
      if (canProceed) {
        setSelectedItem(item);
        setSelectedAction(null);
      }
    },
    [handleItemSelection]
  );

  /**
   * Handle creating a new sequential workflow
   */
  const handleCreateSequential = useCallback(
    (category: string = "Main") => {
      const newWorkflow = createWorkflow({ viewMode: "sequential", category });
      setSelectedItem(newWorkflow);
      setSelectedAction(null);
      setMode("sequential");
    },
    [createWorkflow]
  );

  /**
   * Handle creating a new graph workflow
   */
  const handleCreateGraph = useCallback(
    (category: string = "Main") => {
      const newWorkflow = createWorkflow({ viewMode: "graph", category });
      setSelectedItem(newWorkflow);
      setSelectedAction(null);
      setMode("graph");
    },
    [createWorkflow]
  );

  /**
   * Handle updating the current item
   */
  const handleUpdateItem = useCallback(
    (item: LibraryItem) => {
      updateItem(item);
      setSelectedItem(item);
    },
    [updateItem]
  );

  /**
   * Handle deleting an item
   * Note: Confirmation dialog is shown in UnifiedProcessLibrary
   */
  const handleDeleteItem = useCallback(
    (item: LibraryItem) => {
      deleteItem(item);

      // Clear selection if this was the selected item
      if (selectedItem?.id === item.id) {
        setSelectedItem(null);
        setSelectedAction(null);
      }
    },
    [deleteItem, selectedItem]
  );

  /**
   * Handle batch deleting items
   * Note: Confirmation dialog is shown in UnifiedProcessLibrary
   */
  const handleDeleteItems = useCallback(
    (items: LibraryItem[]) => {
      deleteItems(items);

      // Clear selection if the selected item was deleted
      if (selectedItem && items.some((item) => item.id === selectedItem.id)) {
        setSelectedItem(null);
        setSelectedAction(null);
      }
    },
    [deleteItems, selectedItem]
  );

  /**
   * Handle duplicating an item
   */
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

  /**
   * Update workflow
   */
  const handleUpdateWorkflow = useCallback(
    (workflow: Workflow) => {
      console.log("[AutomationBuilder] handleUpdateWorkflow called:", {
        id: workflow.id,
        name: workflow.name,
        actionsCount: workflow.actions.length,
        actions: workflow.actions.map((a) => ({ id: a.id, type: a.type })),
      });
      updateWorkflow(workflow);
      if (selectedItem?.id === workflow.id) {
        setSelectedItem(workflow);
      }
      console.log("[AutomationBuilder] handleUpdateWorkflow completed");
    },
    [updateWorkflow, selectedItem]
  );

  /**
   * Handle updating actions for sequential editor
   */
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

  /**
   * Handle selecting an action
   */
  const handleSelectAction = useCallback((action: Action | null) => {
    setSelectedAction(action);
  }, []);

  /**
   * Handle adding a node in graph mode
   */
  const handleAddNode = useCallback(
    (nodeType: ActionType) => {
      const callId = Date.now();
      console.log(
        "[AutomationBuilder] handleAddNode called with:",
        nodeType,
        "callId:",
        callId
      );
      console.log(
        "[AutomationBuilder] selectedItem:",
        selectedItem?.id,
        selectedItem?.name
      );
      console.log(
        "[AutomationBuilder] Current actions:",
        selectedItem?.actions
      );

      if (!selectedItem) {
        console.warn("[AutomationBuilder] No selectedItem, cannot add node");
        return;
      }

      const newAction: Action = {
        id: `action-${Date.now()}`,
        type: nodeType,
        config: getDefaultConfig(nodeType),
        position: [100, 100], // Auto-position
      };

      console.log("[AutomationBuilder] Created new action:", newAction);

      const updatedWorkflow = {
        ...selectedItem,
        actions: [...selectedItem.actions, newAction],
      };

      console.log(
        "[AutomationBuilder] Updated workflow actions count:",
        updatedWorkflow.actions.length
      );
      console.log(
        "[AutomationBuilder] Calling handleUpdateWorkflow with callId:",
        callId
      );
      handleUpdateWorkflow(updatedWorkflow);
      console.log(
        "[AutomationBuilder] handleUpdateWorkflow completed for callId:",
        callId
      );
    },
    [selectedItem, handleUpdateWorkflow]
  );

  /**
   * Handle updating an action from the properties panel
   */
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

  /**
   * Handle opening the share dialog
   */
  const handleShare = useCallback(() => {
    if (!selectedItem) return;
    setShareDialogOpen(true);
  }, [selectedItem]);

  /**
   * Handle opening the export dialog
   */
  const handleExport = useCallback(() => {
    if (!selectedItem) return;
    setExportDialogOpen(true);
  }, [selectedItem]);

  /**
   * Handle opening the import dialog
   */
  const handleImport = useCallback(() => {
    setImportDialogOpen(true);
  }, []);

  /**
   * Handle opening the project export dialog
   */
  const handleExportProject = useCallback(() => {
    setProjectExportDialogOpen(true);
  }, []);

  /**
   * Handle importing a workflow
   */
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

  // Render the editor based on mode
  const renderEditor = () => {
    if (!selectedItem) {
      return (
        <EmptyState
          mode={mode}
          onCreateNew={
            mode === "sequential"
              ? () => handleCreateSequential()
              : () => handleCreateGraph()
          }
        />
      );
    }

    if (mode === "sequential") {
      // Sequential mode - SequentialEditor
      // Warn if workflow has branching
      if (!isLinearWorkflow(selectedItem)) {
        return (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-lg">This workflow has branching logic</p>
              <p className="text-sm">Switch to graph mode to edit</p>
            </div>
          </div>
        );
      }

      return (
        <SequentialEditor
          actions={selectedItem.actions}
          selectedAction={selectedAction}
          onSelectAction={handleSelectAction}
          onUpdateActions={handleUpdateActions}
          onAddAction={(action) =>
            handleUpdateActions([...selectedItem.actions, action])
          }
          onDeleteAction={(actionId) =>
            handleUpdateActions(
              selectedItem.actions.filter((a: Action) => a.id !== actionId)
            )
          }
          onDuplicateAction={(actionId) => {
            const action = selectedItem.actions.find(
              (a: Action) => a.id === actionId
            );
            if (action) {
              const duplicated = { ...action, id: `action-${Date.now()}` };
              handleUpdateActions([...selectedItem.actions, duplicated]);
            }
          }}
          onReorderActions={(startIndex, endIndex) => {
            const actions = [...selectedItem.actions];
            const [removed] = actions.splice(startIndex, 1);
            if (removed) {
              actions.splice(endIndex, 0, removed);
              handleUpdateActions(actions);
            }
          }}
        />
      );
    } else {
      // Graph mode - GraphEditor (works with all workflows)
      return (
        <GraphEditor
          workflow={selectedItem}
          selectedNode={selectedAction}
          onSelectNode={handleSelectAction}
          onUpdateWorkflow={handleUpdateWorkflow}
          onAddNode={handleAddNode}
        />
      );
    }
  };

  return (
    <div
      className="flex h-[calc(100vh-4rem)] overflow-hidden"
      data-tutorial-id="automation-builder-container"
    >
      {/* Left Panel - Library */}
      <div
        className="w-64 xl:w-72 2xl:w-80 flex-shrink-0 border-r border-gray-800 bg-[#27272A]/50 overflow-hidden flex flex-col"
        data-tutorial-id="action-library"
      >
        {/* Mode Selector */}
        <div
          className="p-4 border-b border-gray-800"
          data-tutorial-id="mode-selector"
        >
          <BuilderModeSelector mode={mode} onModeChange={setMode} />
        </div>

        {/* Library */}
        <div className="flex-1 p-4 overflow-y-auto">
          <UnifiedProcessLibrary
            selectedItem={selectedItem}
            onSelectItem={handleSelectItem}
            onDeleteItem={handleDeleteItem}
            onDeleteItems={handleDeleteItems}
            onUpdateWorkflow={handleUpdateWorkflow}
            onCreateSequential={handleCreateSequential}
            onCreateGraph={handleCreateGraph}
            onConvertItem={openConversion}
          />
        </div>
      </div>

      {/* Center Panel - Editor */}
      <div
        className="flex-1 min-w-0 flex flex-col overflow-hidden"
        data-tutorial-id="workflow-editor"
      >
        {/* Toolbar */}
        <EditorToolbar
          item={selectedItem}
          mode={mode}
          onDelete={() => selectedItem && handleDeleteItem(selectedItem)}
          onDuplicate={handleDuplicateItem}
          onConvert={() => selectedItem && openConversion(selectedItem)}
          onShare={handleShare}
          onExport={handleExport}
          onImport={handleImport}
          onExportProject={handleExportProject}
        />

        {/* Editor Content */}
        <div className="flex-1 overflow-y-auto">{renderEditor()}</div>
      </div>

      {/* Right Panel - Properties */}
      <div
        className={`${
          mode === "graph"
            ? "w-[20rem] xl:w-[22rem] 2xl:w-[24rem]"
            : "w-[22rem] xl:w-[26rem] 2xl:w-[30rem]"
        } flex-shrink-0 border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto`}
        data-tutorial-id="properties-panel"
      >
        {selectedItem && !selectedAction ? (
          // Show item metadata when no action is selected
          <ItemMetadataPanel
            item={selectedItem}
            onUpdate={handleUpdateItem}
            currentPermission={myPermission}
            collaboratorCount={collaborators.length}
            onOpenShare={handleShare}
            states={states}
          />
        ) : (
          // Show action properties when an action is selected
          <ActionProperties
            action={selectedAction as any}
            onUpdateAction={handleUpdateAction as any}
          />
        )}
      </div>

      {/* Conversion Dialog */}
      <ConversionDialog />

      {/* Share Dialog */}
      {selectedItem && (
        <ShareProjectDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          projectId={selectedItem.id}
          projectName={selectedItem.name}
          collaborators={collaborators}
          organizations={organizations}
          onAddUser={addUser}
          onAddOrganization={addOrganization}
          onChangePermission={changePermission}
          onRevoke={revokeAccess}
          onGenerateLink={generateShareLink}
        />
      )}

      {/* Export Dialog */}
      {selectedItem && (
        <ExportDialog
          workflow={selectedItem}
          open={exportDialogOpen}
          onClose={() => setExportDialogOpen(false)}
        />
      )}

      {/* Import Dialog */}
      <ImportDialog
        open={importDialogOpen}
        onImport={handleImportWorkflow}
        onClose={() => setImportDialogOpen(false)}
      />

      {/* Project Export Dialog */}
      <ProjectExportDialog
        open={projectExportDialogOpen}
        onOpenChange={setProjectExportDialogOpen}
      />
    </div>
  );
}
