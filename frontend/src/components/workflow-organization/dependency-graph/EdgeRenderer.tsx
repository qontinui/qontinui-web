/**
 * Graph Edge Creation Logic
 *
 * Utility hook for creating dependency edges between workflow nodes.
 * Handles edge styling, highlighting, and marker configuration.
 */

"use client";

import { useCallback } from "react";
import { MarkerType } from "@xyflow/react";
import { Workflow } from "../../../lib/action-schema/action-types";
import { WorkflowNode, DependencyEdge, DependencyInfo } from "./types";

interface UseEdgeCreatorParams {
  dependencyMap: Map<string, DependencyInfo>;
  workflows: Workflow[];
  highlightedWorkflows: Set<string>;
}

/**
 * Hook that provides a memoized function for creating edges from nodes.
 */
export function useEdgeCreator({
  dependencyMap,
  workflows,
  highlightedWorkflows,
}: UseEdgeCreatorParams) {
  const createEdges = useCallback(
    (nodes: WorkflowNode[]): DependencyEdge[] => {
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges: DependencyEdge[] = [];

      nodes.forEach((node) => {
        const info = dependencyMap.get(node.id);
        if (!info) return;

        info.dependencies.forEach((depId) => {
          if (!nodeIds.has(depId)) return;

          // Find the action name
          const workflow = workflows.find((w) => w.id === node.id);
          const runWorkflowAction = workflow?.actions.find(
            (a) =>
              a.type === "RUN_WORKFLOW" &&
              (a.config as { workflowId?: string }).workflowId === depId
          );

          const isHighlighted =
            highlightedWorkflows.has(node.id) ||
            highlightedWorkflows.has(depId);

          edges.push({
            id: `${node.id}-${depId}`,
            source: node.id,
            target: depId,
            type: "smoothstep",
            animated: isHighlighted,
            style: {
              stroke: isHighlighted ? "#3b82f6" : "#94a3b8",
              strokeWidth: isHighlighted ? 2 : 1,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isHighlighted ? "#3b82f6" : "#94a3b8",
            },
            data: {
              actionName: runWorkflowAction?.name,
              sourceWorkflowId: node.id,
              targetWorkflowId: depId,
            },
          });
        });
      });

      return edges;
    },
    [dependencyMap, workflows, highlightedWorkflows]
  );

  return createEdges;
}
