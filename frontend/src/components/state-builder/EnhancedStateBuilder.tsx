/**
 * Enhanced State Builder for Large Projects
 *
 * A comprehensive state management interface with:
 * - Hierarchical group structure navigation
 * - Visual state canvas with image/region/location editing
 * - Advanced search and filtering
 * - Bulk operations
 * - State comparison and relationship visualization
 * - Template system
 */

"use client";

import React from "react";
import { Plus, GitBranch } from "lucide-react";
import { useAutomation } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import { StateNavigator } from "./StateNavigator";
import { StateCanvas } from "./StateCanvas";
import { PropertiesPanel } from "./PropertiesPanel";
import { TemplateDialog } from "./_components/TemplateDialog";
import { BulkOperationsDialog } from "./_components/BulkOperationsDialog";
import { GraphDialog } from "./_components/GraphDialog";
import { useStateBuilderState } from "./_hooks/useStateBuilderState";
import { useStateBuilderHandlers } from "./_hooks/useStateBuilderHandlers";
import { useStateFilters } from "./_hooks/useStateFilters";

export function EnhancedStateBuilder() {
  const {
    states,
    transitions,
    addState,
    updateState,
    deleteState,
    resolvePatternImage,
  } = useAutomation();

  const builderState = useStateBuilderState(states);

  const {
    filteredStates,
    stateComplexity,
    stateHasImages,
    stateHasTransitions,
  } = useStateFilters({
    states,
    transitions,
    searchQuery: builderState.searchQuery,
    selectedGroupId: builderState.selectedGroupId,
    filterTags: builderState.filterTags,
    filterHasImages: builderState.filterHasImages,
    filterHasTransitions: builderState.filterHasTransitions,
  });

  const handlers = useStateBuilderHandlers({
    addState,
    updateState,
    deleteState,
    states,
    currentState: builderState.currentState,
    currentStateId: builderState.currentStateId,
    selectedImageIndex: builderState.selectedImageIndex,
    setCurrentStateId: builderState.setCurrentStateId,
    setSelectedStateIds: builderState.setSelectedStateIds,
    setShowTemplateDialog: builderState.setShowTemplateDialog,
    setShowBulkDialog: builderState.setShowBulkDialog,
    setSelectedImageIndex: builderState.setSelectedImageIndex,
  });

  return (
    <div className="h-screen flex flex-col p-4 gap-4 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Enhanced State Builder</h1>
          <p className="text-sm text-muted-foreground">
            {filteredStates.length} state(s) -{" "}
            {builderState.selectedStateIds.size} selected
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => builderState.setShowGraphDialog(true)}
          >
            <GitBranch className="h-4 w-4 mr-2" />
            View Graph
          </Button>
          <Button
            variant="outline"
            onClick={() => builderState.setShowTemplateDialog(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            From Template
          </Button>
          <Button onClick={handlers.handleCreateState}>
            <Plus className="h-4 w-4 mr-2" />
            New State
          </Button>
        </div>
      </div>

      {/* Main Layout: 3-column */}
      <div className="flex-1 grid grid-cols-[300px_1fr_350px] gap-4 overflow-hidden">
        {/* Left: Navigator */}
        <StateNavigator
          searchQuery={builderState.searchQuery}
          setSearchQuery={builderState.setSearchQuery}
          filterHasImages={builderState.filterHasImages}
          setFilterHasImages={builderState.setFilterHasImages}
          filterHasTransitions={builderState.filterHasTransitions}
          setFilterHasTransitions={builderState.setFilterHasTransitions}
          setFilterTags={builderState.setFilterTags}
          filteredStates={filteredStates}
          currentStateId={builderState.currentStateId}
          setCurrentStateId={builderState.setCurrentStateId}
          selectedStateIds={builderState.selectedStateIds}
          setShowBulkDialog={builderState.setShowBulkDialog}
          setShowTemplateDialog={builderState.setShowTemplateDialog}
          stateComplexity={stateComplexity}
          stateHasImages={stateHasImages}
          stateHasTransitions={stateHasTransitions}
          handleToggleStateSelection={handlers.handleToggleStateSelection}
          handleDeleteState={handlers.handleDeleteState}
          handleCreateState={handlers.handleCreateState}
          addState={addState}
        />

        {/* Center: Canvas */}
        <StateCanvas
          currentState={builderState.currentState}
          canvasZoom={builderState.canvasZoom}
          canvasPan={builderState.canvasPan}
          setCanvasZoom={builderState.setCanvasZoom}
          setCanvasPan={builderState.setCanvasPan}
          selectedImageIndex={builderState.selectedImageIndex}
          setSelectedImageIndex={builderState.setSelectedImageIndex}
          resolvePatternImage={resolvePatternImage}
          handleAddStateImage={handlers.handleAddStateImage}
        />

        {/* Right: Properties */}
        <PropertiesPanel
          currentState={builderState.currentState}
          activeTab={builderState.activeTab}
          setActiveTab={builderState.setActiveTab}
          handleUpdateCurrentState={handlers.handleUpdateCurrentState}
          handleAddStateImage={handlers.handleAddStateImage}
          handleRemoveStateImage={handlers.handleRemoveStateImage}
          handleAddRegion={handlers.handleAddRegion}
          handleAddLocation={handlers.handleAddLocation}
          stateComplexity={stateComplexity}
          resolvePatternImage={resolvePatternImage}
        />
      </div>

      {/* Dialogs */}
      <TemplateDialog
        open={builderState.showTemplateDialog}
        onOpenChange={builderState.setShowTemplateDialog}
        templates={builderState.templates}
        onCreateFromTemplate={handlers.handleCreateStateFromTemplate}
      />

      <BulkOperationsDialog
        open={builderState.showBulkDialog}
        onOpenChange={builderState.setShowBulkDialog}
        selectedCount={builderState.selectedStateIds.size}
        onBulkOperation={handlers.handleBulkOperation}
        selectedStateIds={builderState.selectedStateIds}
      />

      <GraphDialog
        open={builderState.showGraphDialog}
        onOpenChange={builderState.setShowGraphDialog}
        transitionCount={transitions.length}
      />
    </div>
  );
}
