"use client";

import React from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { NetworkIcon } from "lucide-react";
import { RequireProject } from "@/components/require-project";
import { useDependenciesData } from "./_hooks/use-dependencies-data";
import { DependenciesHeader } from "./_components/DependenciesHeader";
import { DependencyGraph } from "./_components/DependencyGraph";
import { AnalysisPanel } from "./_components/AnalysisPanel";
import { SelectedWorkflowSheet } from "./_components/SelectedWorkflowSheet";

// ============================================================================
// Main Component
// ============================================================================

function DependenciesPageInner() {
  const {
    // Data
    workflows,
    graph,
    stats,
    selectedWorkflow,
    unusedWorkflows,
    criticalWorkflows,

    // ReactFlow state
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,

    // Persisted UI state
    isHydrating,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    filtersOpen,
    setFiltersOpen,
    filters,
    setFilters,
    setSelectedWorkflowId,

    // Handlers
    handleNodeClick,
    handleExportReport,
    handleAnalyzeAll,
    handleDetectCircular,
    handleFindUnused,
    handleHighlightCycle,
  } = useDependenciesData();

  // Show loading state during hydration
  if (isHydrating) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex items-center px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold">Workflow Dependencies</h1>
        </div>
        <div className="flex items-center justify-center flex-1">
          <p className="text-muted-foreground">Loading saved state...</p>
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex items-center px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold">Workflow Dependencies</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="flex flex-col items-center">
            <NetworkIcon className="size-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Workflows Found</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Create some workflows in the Automation Builder to see dependency
              analysis
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <DependenciesHeader
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        filters={filters}
        setFilters={setFilters}
        onAnalyzeAll={handleAnalyzeAll}
        onDetectCircular={handleDetectCircular}
        onFindUnused={handleFindUnused}
        onExportReport={handleExportReport}
      />

      {/* Main Content - Two Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column - Graph (70%) */}
        <DependencyGraph
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          graph={graph}
        />

        {/* Right Column - Analysis Panel (30%) */}
        <AnalysisPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          graph={graph}
          stats={stats}
          workflows={workflows}
          unusedWorkflows={unusedWorkflows}
          criticalWorkflows={criticalWorkflows}
          onHighlightCycle={handleHighlightCycle}
        />
      </div>

      {/* Selected Workflow Bottom Sheet */}
      {selectedWorkflow && (
        <SelectedWorkflowSheet
          selectedWorkflow={selectedWorkflow}
          onClose={() => setSelectedWorkflowId(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Page Component (with Provider)
// ============================================================================

export default function DependenciesPage() {
  return (
    <RequireProject pageName="Dependencies">
      <ReactFlowProvider>
        <DependenciesPageInner />
      </ReactFlowProvider>
    </RequireProject>
  );
}
