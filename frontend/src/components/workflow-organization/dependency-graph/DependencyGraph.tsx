"use client";

import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "../../../lib/utils";
import { DependencyGraphProps } from "./types";
import { GraphCanvas } from "./GraphCanvas";
import { GraphControls } from "./GraphControls";
import { AnalysisPanel } from "./_components/AnalysisPanel";
import { useDependencyGraph } from "./_hooks/useDependencyGraph";

function DependencyGraphInner({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onOpenWorkflow,
  className,
}: DependencyGraphProps) {
  const {
    nodes,
    edges,
    layout,
    searchQuery,
    showAnalysis,
    selectedFilter,
    contextMenu,
    analysis,
    setLayout,
    setSelectedFilter,
    setShowAnalysis,
    setContextMenu,
    onNodesChange,
    onEdgesChange,
    handleNodeClick,
    handleNodeDoubleClick,
    handleNodeContextMenu,
    handleFitView,
    handleZoomIn,
    handleZoomOut,
    handleCenterOnSelected,
    handleSearch,
    handleHighlightCircular,
    handleExport,
    handleShowDependencies,
    handleShowDependents,
  } = useDependencyGraph({
    workflows,
    selectedWorkflowId,
    onSelectWorkflow,
    onOpenWorkflow,
  });

  return (
    <div className={cn("flex h-full", className)}>
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        contextMenu={contextMenu}
        onCloseContextMenu={() => setContextMenu(null)}
        onOpenWorkflow={onOpenWorkflow}
        onShowDependencies={handleShowDependencies}
        onShowDependents={handleShowDependents}
        onCenterOnNode={handleCenterOnSelected}
      >
        <GraphControls
          searchQuery={searchQuery}
          onSearch={handleSearch}
          layout={layout}
          onLayoutChange={setLayout}
          selectedFilter={selectedFilter}
          onFilterChange={setSelectedFilter}
          onExport={handleExport}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
          onCenterOnSelected={handleCenterOnSelected}
          selectedWorkflowId={selectedWorkflowId}
          showAnalysis={showAnalysis}
          onToggleAnalysis={() => setShowAnalysis(!showAnalysis)}
          workflowCount={workflows.length}
          totalDependencies={analysis.totalDependencies}
          circularCount={analysis.circularDependencies.length}
          unusedCount={analysis.unusedWorkflows.length}
        />
      </GraphCanvas>

      {showAnalysis && (
        <AnalysisPanel
          analysis={analysis}
          workflows={workflows}
          onSelectWorkflow={onSelectWorkflow}
          onHighlightCircular={handleHighlightCircular}
          onClose={() => setShowAnalysis(false)}
        />
      )}
    </div>
  );
}

export function DependencyGraph(props: DependencyGraphProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
