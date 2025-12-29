"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Download, Upload, GitBranch, List } from "lucide-react";
import { ReactFlowProvider } from "@xyflow/react";
import { WorkflowCanvas } from "@/components/workflow-canvas/WorkflowCanvas";
import { NodePalette } from "@/components/workflow-canvas/NodePalette";
import { useAutomation } from "@/contexts/automation-context";
import { Workflow, Action, ActionType } from "@/lib/action-schema/action-types";
import { ActionProperties } from "@/components/action-properties";
import { toast } from "sonner";

/**
 * Graph Workflow Builder - Visual workflow editor with canvas
 *
 * Provides a drag-and-drop interface for creating non-linear workflows
 * with branching, loops, and merge nodes.
 */
export function GraphWorkflowBuilder() {
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

  // Load workflows from context
  useEffect(() => {
    setWorkflowList(workflows);

    // Select first workflow if none selected
    if (workflows.length > 0 && !selectedWorkflow) {
      setSelectedWorkflow(workflows[0] ?? null);
    }
  }, [workflows]);

  /**
   * Create new empty workflow
   */
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

    // Save to IndexedDB via context
    addWorkflow(newWorkflow);
    setSelectedWorkflow(newWorkflow);

    toast.success("Workflow created", {
      description: "New graph workflow created successfully.",
    });
  }, [addWorkflow]);

  /**
   * Update workflow when canvas changes
   */
  const handleWorkflowChange = useCallback(
    (updatedWorkflow: Workflow) => {
      const workflowWithTimestamp = {
        ...updatedWorkflow,
        metadata: {
          ...updatedWorkflow.metadata,
          modified: new Date().toISOString(),
        },
      };

      // Update in IndexedDB via context
      updateWorkflow(workflowWithTimestamp);
      setSelectedWorkflow(workflowWithTimestamp);
    },
    [updateWorkflow]
  );

  /**
   * Handle node click in canvas
   */
  const handleNodeClick = useCallback((action: Action) => {
    setSelectedAction(action);
  }, []);

  /**
   * Handle node add from palette
   */
  const handleNodeAdd = useCallback(
    (nodeType: ActionType) => {
      console.log(
        "[GraphWorkflowBuilder] handleNodeAdd called with:",
        nodeType
      );
      console.log(
        "[GraphWorkflowBuilder] selectedWorkflow:",
        selectedWorkflow?.id,
        selectedWorkflow?.name
      );
      console.log(
        "[GraphWorkflowBuilder] Current actions count:",
        selectedWorkflow?.actions.length
      );

      if (!selectedWorkflow) {
        console.error("[GraphWorkflowBuilder] No workflow selected!");
        return;
      }

      const newAction: Action = {
        id: `action-${Date.now()}`,
        type: nodeType,
        config: {},
        position: [100, 100], // Will be positioned by canvas - MUST BE AN ARRAY
      };

      console.log("[GraphWorkflowBuilder] Created new action:", newAction);

      const updatedWorkflow: Workflow = {
        ...selectedWorkflow,
        actions: [...selectedWorkflow.actions, newAction],
        metadata: {
          ...selectedWorkflow.metadata,
          modified: new Date().toISOString(),
        },
      };

      console.log(
        "[GraphWorkflowBuilder] Updated workflow actions count:",
        updatedWorkflow.actions.length
      );
      console.log(
        "[GraphWorkflowBuilder] Updated workflow actions:",
        updatedWorkflow.actions
      );

      handleWorkflowChange(updatedWorkflow);

      toast.success("Node added", {
        description: `${nodeType} node added to canvas`,
      });
    },
    [selectedWorkflow, handleWorkflowChange]
  );

  /**
   * Update action properties
   */
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

  /**
   * Delete workflow
   */
  const handleDeleteWorkflow = useCallback(
    (workflowId: string) => {
      if (!confirm("Delete this workflow? This action cannot be undone.")) {
        return;
      }

      // Delete from IndexedDB via context
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

  /**
   * Rename workflow
   */
  const handleRenameWorkflow = useCallback(() => {
    if (!selectedWorkflow || !tempName.trim()) {
      setIsEditingName(false);
      return;
    }

    const updatedWorkflow = { ...selectedWorkflow, name: tempName.trim() };

    // Update in IndexedDB via context
    updateWorkflow(updatedWorkflow);
    setSelectedWorkflow(updatedWorkflow);
    setIsEditingName(false);

    toast.success("Workflow renamed");
  }, [selectedWorkflow, tempName, updateWorkflow]);

  /**
   * Export workflow to JSON
   */
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

  /**
   * Import workflow from JSON
   */
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

        // Validate basic structure
        if (!workflow.id || !workflow.name || !workflow.format) {
          throw new Error("Invalid workflow file");
        }

        // Ensure graph format
        if (workflow.format !== "graph") {
          toast.error("Import failed", {
            description: "Only graph format workflows can be imported here.",
          });
          return;
        }

        // Save to IndexedDB via context
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

  return (
    <ReactFlowProvider>
      <div className="flex h-full" data-tutorial-id="graph-builder-container">
        {/* Left Panel - Workflow List */}
        <div
          className="w-64 border-r border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto flex-shrink-0"
          data-tutorial-id="workflow-list"
        >
          <div className="space-y-4">
            <Button
              onClick={handleCreateWorkflow}
              className="w-full bg-[#00FF88] hover:bg-[#00FF88]/80 text-black font-medium"
              data-tutorial-id="create-workflow"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Workflow
            </Button>

            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-400 px-2 mb-2">
                WORKFLOWS ({workflowList.length})
              </div>

              {workflowList.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-8">
                  <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No workflows yet</p>
                  <p className="text-xs">Create one to get started</p>
                </div>
              ) : (
                workflowList.map((workflow) => (
                  <div
                    key={workflow.id}
                    className={`p-3 rounded-md cursor-pointer transition-colors ${
                      selectedWorkflow?.id === workflow.id
                        ? "bg-[#00FF88]/20 border border-[#00FF88]"
                        : "bg-gray-800/50 hover:bg-gray-800 border border-transparent"
                    }`}
                    onClick={() => {
                      setSelectedWorkflow(workflow);
                      setSelectedAction(null);
                    }}
                  >
                    <div className="font-medium text-sm text-gray-200">
                      {workflow.name}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {workflow.actions.length} actions
                    </div>

                    {selectedWorkflow?.id === workflow.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteWorkflow(workflow.id);
                        }}
                        className="w-full mt-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center Panel - Canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedWorkflow ? (
            <>
              {/* Toolbar */}
              <div className="border-b border-gray-800 bg-[#27272A]/50 p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={tempName}
                        onChange={(e) => setTempName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameWorkflow();
                          if (e.key === "Escape") setIsEditingName(false);
                        }}
                        className="text-lg font-bold bg-transparent border-gray-700 focus:border-[#00FF88] h-8"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleRenameWorkflow}
                        className="bg-[#00FF88] text-black"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditingName(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <h2
                      className="text-lg font-bold text-[#00FF88] cursor-pointer hover:underline"
                      onClick={() => {
                        setTempName(selectedWorkflow.name);
                        setIsEditingName(true);
                      }}
                    >
                      {selectedWorkflow.name}
                    </h2>
                  )}

                  <div className="text-sm text-gray-400">
                    {selectedWorkflow.actions.length} actions •{" "}
                    {Object.keys(selectedWorkflow.connections || {}).length}{" "}
                    connections
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleImportWorkflow}
                    className="border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88]"
                    data-tutorial-id="import-workflow"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Import
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportWorkflow}
                    className="border-gray-700 hover:border-[#00FF88] hover:text-[#00FF88]"
                    data-tutorial-id="export-workflow"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                </div>
              </div>

              {/* Canvas with Node Palette */}
              <div
                className="flex-1 min-h-0 flex relative"
                ref={canvasRef}
                data-tutorial-id="graph-canvas"
              >
                {/* Node Palette - Left side */}
                <div
                  className="absolute left-0 top-0 bottom-0 z-10 w-80"
                  data-tutorial-id="node-palette-panel"
                >
                  <NodePalette
                    position="left"
                    showSearch={true}
                    showRecent={true}
                    showFavorites={true}
                    onNodeAdd={handleNodeAdd}
                    canvasRef={canvasRef}
                  />
                </div>

                {/* Canvas */}
                <div className="flex-1">
                  <WorkflowCanvas
                    workflow={selectedWorkflow}
                    onWorkflowChange={handleWorkflowChange}
                    onNodeClick={handleNodeClick}
                    skipProvider={true}
                    settings={{
                      showGrid: true,
                      showMinimap: true,
                      showControls: true,
                      snapToGrid: true,
                      gridSize: 15,
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <GitBranch className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Select a workflow to edit</p>
                <p className="text-sm">or create a new one to get started</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Action Properties */}
        <div
          className="w-96 border-l border-gray-800 bg-[#27272A]/50 p-4 overflow-y-auto flex-shrink-0"
          data-tutorial-id="graph-properties"
        >
          {selectedAction ? (
            <ActionProperties
              action={selectedAction}
              onUpdateAction={(action) =>
                handleUpdateAction(action as unknown as Action)
              }
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <List className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">Select a node to edit</p>
                <p className="text-xs mt-1">Click on a node in the canvas</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
