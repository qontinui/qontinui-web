"use client";

import { useAccessibilityInspector } from "./_hooks/useAccessibilityInspector";
import { InspectForm } from "./_components/InspectForm";
import { TreeResultsPanel } from "./_components/TreeResultsPanel";
import { EmptyState } from "./_components/EmptyState";

export function AccessibilityPanel() {
  const {
    targetUrl,
    setTargetUrl,
    isInspecting,
    inspectError,
    treeData,
    searchQuery,
    setSearchQuery,
    nodeCount,
    selectedNode,
    interactiveNodes,
    handleInspect,
    handleCaptureTree,
    handleSelectNode,
    clearSelectedNode,
  } = useAccessibilityInspector();

  return (
    <div className="space-y-6">
      <InspectForm
        targetUrl={targetUrl}
        setTargetUrl={setTargetUrl}
        isInspecting={isInspecting}
        inspectError={inspectError}
        onInspect={handleInspect}
        onCaptureTree={handleCaptureTree}
      />

      {treeData ? (
        <TreeResultsPanel
          treeData={treeData}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          nodeCount={nodeCount}
          selectedNode={selectedNode}
          interactiveNodes={interactiveNodes}
          onSelectNode={handleSelectNode}
          onClearSelectedNode={clearSelectedNode}
        />
      ) : (
        !isInspecting && !inspectError && <EmptyState />
      )}
    </div>
  );
}
