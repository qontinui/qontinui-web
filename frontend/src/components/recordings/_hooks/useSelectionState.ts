"use client";

import { useState, useCallback } from "react";
import { Node, Edge } from "@xyflow/react";
import {
  type DiscoveredState,
  type DiscoveredStateStructure,
  type DiscoveredTransition,
} from "@/types/recording";

export function useSelectionState() {
  const [selectedStateIds, setSelectedStateIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedTransitionIds, setSelectedTransitionIds] = useState<
    Set<string>
  >(new Set());
  const [selectedNode, setSelectedNode] = useState<DiscoveredState | null>(
    null
  );
  const [selectedEdge, setSelectedEdge] = useState<DiscoveredTransition | null>(
    null
  );

  const initializeSelections = useCallback(
    (stateIds: string[], transitionIds: string[]) => {
      setSelectedStateIds(new Set(stateIds));
      setSelectedTransitionIds(new Set(transitionIds));
    },
    []
  );

  const toggleStateSelection = useCallback((stateId: string) => {
    setSelectedStateIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(stateId)) {
        newSet.delete(stateId);
      } else {
        newSet.add(stateId);
      }
      return newSet;
    });
  }, []);

  const toggleTransitionSelection = useCallback((transitionId: string) => {
    setSelectedTransitionIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(transitionId)) {
        newSet.delete(transitionId);
      } else {
        newSet.add(transitionId);
      }
      return newSet;
    });
  }, []);

  const handleNodeClick = useCallback(
    (
      _event: React.MouseEvent,
      node: Node,
      structure: DiscoveredStateStructure | null
    ) => {
      const state = structure?.states.find((s) => s.id === node.id);
      if (state) {
        setSelectedNode(state);
        setSelectedEdge(null);
      }
    },
    []
  );

  const handleEdgeClick = useCallback(
    (
      _event: React.MouseEvent,
      edge: Edge,
      structure: DiscoveredStateStructure | null
    ) => {
      const transition = structure?.transitions.find((t) => t.id === edge.id);
      if (transition) {
        setSelectedEdge(transition);
        setSelectedNode(null);
      }
    },
    []
  );

  return {
    selectedStateIds,
    selectedTransitionIds,
    selectedNode,
    selectedEdge,
    initializeSelections,
    toggleStateSelection,
    toggleTransitionSelection,
    handleNodeClick,
    handleEdgeClick,
  };
}
