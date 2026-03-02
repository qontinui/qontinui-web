"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useGraphWorkflowBuilder } from "./_hooks/use-graph-workflow-builder";
import { WorkflowListPanel } from "./_components/WorkflowListPanel";
import { WorkflowToolbar } from "./_components/WorkflowToolbar";
import { CanvasPanel } from "./_components/CanvasPanel";
import { PropertiesPanel } from "./_components/PropertiesPanel";
import { EmptyWorkflowState } from "./_components/EmptyWorkflowState";

export function GraphWorkflowBuilder() {
  const {
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
  } = useGraphWorkflowBuilder();

  return (
    <ReactFlowProvider>
      <div className="flex h-full" data-tutorial-id="graph-builder-container">
        <WorkflowListPanel
          workflowList={workflowList}
          selectedWorkflowId={selectedWorkflow?.id}
          onCreateWorkflow={handleCreateWorkflow}
          onSelectWorkflow={selectWorkflow}
          onDeleteWorkflow={handleDeleteWorkflow}
        />

        <div className="flex-1 flex flex-col min-w-0">
          {selectedWorkflow ? (
            <>
              <WorkflowToolbar
                workflow={selectedWorkflow}
                isEditingName={isEditingName}
                tempName={tempName}
                onTempNameChange={setTempName}
                onRenameWorkflow={handleRenameWorkflow}
                onStartEditingName={startEditingName}
                onCancelEditingName={cancelEditingName}
                onImportWorkflow={handleImportWorkflow}
                onExportWorkflow={handleExportWorkflow}
              />
              <CanvasPanel
                workflow={selectedWorkflow}
                canvasRef={canvasRef}
                onWorkflowChange={handleWorkflowChange}
                onNodeClick={handleNodeClick}
                onNodeAdd={handleNodeAdd}
              />
            </>
          ) : (
            <EmptyWorkflowState />
          )}
        </div>

        <PropertiesPanel
          selectedAction={selectedAction}
          onUpdateAction={handleUpdateAction}
        />
      </div>
    </ReactFlowProvider>
  );
}
