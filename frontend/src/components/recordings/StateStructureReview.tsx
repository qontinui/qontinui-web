"use client";

import { useCallback } from "react";
import { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card, CardContent } from "@/components/ui/card";
import { useStateStructure } from "./_hooks/useStateStructure";
import { useSelectionState } from "./_hooks/useSelectionState";
import { useAcceptanceActions } from "./_hooks/useAcceptanceActions";
import { FlowCanvas } from "./_components/FlowCanvas";
import { StructureOverviewCard } from "./_components/StructureOverviewCard";
import { StateDetailCard } from "./_components/StateDetailCard";
import { TransitionDetailCard } from "./_components/TransitionDetailCard";

interface StateStructureReviewProps {
  recordingId: string;
}

export function StateStructureReview({
  recordingId,
}: StateStructureReviewProps) {
  const {
    selectedStateIds,
    selectedTransitionIds,
    selectedNode,
    selectedEdge,
    initializeSelections,
    toggleStateSelection,
    toggleTransitionSelection,
    handleNodeClick,
    handleEdgeClick,
  } = useSelectionState();

  const { structure, loading, nodes, edges, onNodesChange, onEdgesChange } =
    useStateStructure(
      recordingId,
      selectedStateIds,
      selectedTransitionIds,
      initializeSelections
    );

  const { accepting, handleAcceptAll, handleAcceptSelected, handleDiscard } =
    useAcceptanceActions(recordingId, selectedStateIds, selectedTransitionIds);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      handleNodeClick(event, node, structure);
    },
    [handleNodeClick, structure]
  );

  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      handleEdgeClick(event, edge, structure);
    },
    [handleEdgeClick, structure]
  );

  if (loading || !structure) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="h-8 w-8 animate-spin border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-muted-foreground">Loading state structure...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4">
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        selectedCount={selectedStateIds.size}
        accepting={accepting}
        onAcceptAll={handleAcceptAll}
        onAcceptSelected={handleAcceptSelected}
        onDiscard={handleDiscard}
      />

      <div className="w-full lg:w-96 space-y-4">
        <StructureOverviewCard structure={structure} />

        {selectedNode && (
          <StateDetailCard
            state={selectedNode}
            isSelected={selectedStateIds.has(selectedNode.id)}
            onToggleSelection={toggleStateSelection}
          />
        )}

        {selectedEdge && (
          <TransitionDetailCard
            transition={selectedEdge}
            isSelected={selectedTransitionIds.has(selectedEdge.id)}
            onToggleSelection={toggleTransitionSelection}
          />
        )}
      </div>
    </div>
  );
}
