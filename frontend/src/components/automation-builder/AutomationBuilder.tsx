"use client";

import React, { Suspense } from "react";
import { UnifiedProcessLibrary } from "@/components/unified-process-library";
import { ActionProperties } from "@/components/action-properties";
import { BuilderModeSelector } from "./components/BuilderModeSelector";
import { ItemMetadataPanel } from "./components/ItemMetadataPanel";
import { EditorToolbar } from "./components/EditorToolbar";
import { EditorContent } from "./components/EditorContent";
import { BuilderDialogs } from "./components/BuilderDialogs";
import { useBuilderState } from "./hooks/useBuilderState";

function AutomationBuilderContent() {
  const builder = useBuilderState();

  return (
    <div
      className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden"
      data-tutorial-id="automation-builder-container"
    >
      {/* Main content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Panel - Library */}
        <div
          className="w-64 xl:w-72 2xl:w-80 flex-shrink-0 border-r border-border-subtle bg-surface-raised/50 overflow-hidden flex flex-col"
          data-tutorial-id="action-library"
        >
          {/* Mode Selector */}
          <div
            className="p-4 border-b border-border-subtle"
            data-tutorial-id="mode-selector"
          >
            <BuilderModeSelector
              mode={builder.mode}
              onModeChange={builder.setMode}
            />
          </div>

          {/* Library */}
          <div className="flex-1 p-4 overflow-y-auto">
            <UnifiedProcessLibrary
              selectedItem={builder.selectedItem}
              onSelectItem={builder.handleSelectItem}
              onDeleteItem={builder.handleDeleteItem}
              onDeleteItems={builder.handleDeleteItems}
              onUpdateWorkflow={builder.handleUpdateWorkflow}
              onCreateSequential={builder.handleCreateSequential}
              onCreateGraph={builder.handleCreateGraph}
              onConvertItem={builder.openConversion}
            />
          </div>
        </div>

        {/* Center Panel - Editor (constrained width for action timeline) */}
        <div
          className="flex-1 min-w-0 max-w-2xl flex flex-col overflow-hidden"
          data-tutorial-id="workflow-editor"
        >
          {/* Toolbar */}
          <EditorToolbar
            item={builder.selectedItem}
            mode={builder.mode}
            onDelete={() =>
              builder.selectedItem &&
              builder.handleDeleteItem(builder.selectedItem)
            }
            onDuplicate={builder.handleDuplicateItem}
            onConvert={() =>
              builder.selectedItem &&
              builder.openConversion(builder.selectedItem)
            }
            onRun={builder.handleRun}
            onShare={builder.handleShare}
            onExport={builder.handleExport}
            onImport={builder.handleImport}
            onVerifyProject={builder.handleVerifyProject}
            onExportProject={builder.handleExportProject}
          />

          {/* Editor Content */}
          <div className="flex-1 overflow-y-auto">
            <EditorContent
              mode={builder.mode}
              selectedItem={builder.selectedItem}
              selectedAction={builder.selectedAction}
              onSelectAction={builder.handleSelectAction}
              onUpdateActions={builder.handleUpdateActions}
              onUpdateWorkflow={builder.handleUpdateWorkflow}
              onAddNode={builder.handleAddNode}
              onCreateSequential={() => builder.handleCreateSequential()}
              onCreateGraph={() => builder.handleCreateGraph()}
            />
          </div>
        </div>

        {/* Right Panel - Properties */}
        <div
          className="flex-1 min-w-[20rem] border-l border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto"
          data-tutorial-id="properties-panel"
        >
          {builder.selectedItem && !builder.selectedAction ? (
            <ItemMetadataPanel
              item={builder.selectedItem}
              onUpdate={builder.handleUpdateItem}
              currentPermission={builder.myPermission}
              collaboratorCount={builder.collaborators.length}
              onOpenShare={builder.handleShare}
              states={builder.states}
            />
          ) : (
            <ActionProperties
              action={
                builder.selectedAction as import("@/components/action-properties/types").Action
              }
              onUpdateAction={
                builder.handleUpdateAction as (
                  action: import("@/components/action-properties/types").Action
                ) => void
              }
              workflow={builder.selectedItem}
            />
          )}
        </div>
      </div>

      {/* Dialogs */}
      <BuilderDialogs
        selectedItem={builder.selectedItem}
        shareDialogOpen={builder.shareDialogOpen}
        onShareDialogChange={builder.setShareDialogOpen}
        collaborators={builder.collaborators}
        organizations={builder.organizations}
        onAddUser={builder.addUser}
        onAddOrganization={builder.addOrganization}
        onChangePermission={builder.changePermission}
        onRevoke={builder.revokeAccess}
        onGenerateLink={builder.generateShareLink}
        exportDialogOpen={builder.exportDialogOpen}
        onExportDialogClose={() => builder.setExportDialogOpen(false)}
        importDialogOpen={builder.importDialogOpen}
        onImportWorkflow={builder.handleImportWorkflow}
        onImportDialogClose={() => builder.setImportDialogOpen(false)}
        projectExportDialogOpen={builder.projectExportDialogOpen}
        onProjectExportDialogChange={builder.setProjectExportDialogOpen}
        validationDialogOpen={builder.validationDialogOpen}
        onValidationDialogChange={builder.setValidationDialogOpen}
        validationResults={builder.validationResults}
        onNavigateToWorkflow={builder.handleNavigateToWorkflow}
        ConversionDialog={builder.ConversionDialog}
      />
    </div>
  );
}

export function AutomationBuilder() {
  return (
    <Suspense fallback={null}>
      <AutomationBuilderContent />
    </Suspense>
  );
}
