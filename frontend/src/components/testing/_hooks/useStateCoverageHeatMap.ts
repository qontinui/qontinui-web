import { useCallback, useMemo, useState } from "react";
import { useStateGraph } from "@/hooks/useTesting";
import { Node, Edge, MarkerType } from "@xyflow/react";
import dagre from "dagre";
import type {
  StateNodeData,
  NodeExecutionDetails,
  CoverageStats,
} from "../StateCoverageHeatMap.types";

function getNodeStatus(
  visitCount: number,
  successRate: number
): StateNodeData["status"] {
  if (visitCount === 0) return "uncovered";
  if (successRate >= 90) return "passing";
  if (successRate >= 70) return "partial";
  return "failing";
}

function getEdgeColor(rate: number, covered: boolean): string {
  if (!covered) return "var(--color-border-subtle)";
  if (rate >= 90) return "#10b981";
  if (rate >= 70) return "#eab308";
  return "#ef4444";
}

function getEdgeWidth(covered: boolean, attemptCount: number): number {
  if (!covered) return 1;
  return Math.min(1 + Math.log10(attemptCount + 1) * 2, 5);
}

export function useStateCoverageHeatMap(projectId: string, workflowId: string) {
  const [selectedNode, setSelectedNode] = useState<NodeExecutionDetails | null>(
    null
  );

  const {
    data: graphData,
    isLoading,
    error,
  } = useStateGraph(projectId, workflowId);

  const coverageStats = useMemo<CoverageStats | null>(() => {
    if (!graphData) return null;

    const nodes = graphData.nodes;
    return {
      passing: nodes.filter((n) => n.visit_count > 0 && n.success_rate >= 90)
        .length,
      partial: nodes.filter(
        (n) => n.visit_count > 0 && n.success_rate >= 70 && n.success_rate < 90
      ).length,
      failing: nodes.filter((n) => n.visit_count > 0 && n.success_rate < 70)
        .length,
      uncovered: nodes.filter((n) => n.visit_count === 0).length,
      total: nodes.length,
    };
  }, [graphData]);

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!graphData) {
      return { initialNodes: [] as Node[], initialEdges: [] as Edge[] };
    }

    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: "LR", nodesep: 100, ranksep: 150 });

    graphData.nodes.forEach((node) => {
      dagreGraph.setNode(node.id, { width: 200, height: 80 });
    });

    graphData.edges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const nodes: Node[] = graphData.nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const covered = node.visit_count > 0;
      const status = getNodeStatus(node.visit_count, node.success_rate);

      return {
        id: node.id,
        type: "coverageStateNode",
        position: {
          x: nodeWithPosition.x - 100,
          y: nodeWithPosition.y - 40,
        },
        data: {
          label: node.label,
          visit_count: node.visit_count,
          success_rate: node.success_rate,
          covered,
          status,
        },
      };
    });

    const edges: Edge[] = graphData.edges.map((edge) => {
      const covered = edge.attempt_count > 0;
      const color = getEdgeColor(edge.success_rate, covered);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: covered
          ? `${edge.label} (${edge.success_rate.toFixed(0)}%)`
          : edge.label,
        animated: covered && edge.success_rate < 70,
        style: {
          stroke: color,
          strokeWidth: getEdgeWidth(covered, edge.attempt_count),
          strokeDasharray: covered ? "0" : "5, 5",
        },
        labelStyle: {
          fill: covered ? "#fff" : "#888",
          fontSize: 12,
        },
        labelBgStyle: {
          fill: "var(--color-surface-raised)",
          fillOpacity: 0.9,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
        },
      };
    });

    return { initialNodes: nodes, initialEdges: edges };
  }, [graphData]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeData = node.data as unknown as StateNodeData;
      const graphNode = graphData?.nodes.find((n) => n.id === node.id);

      if (!graphNode) return;

      const successfulAttempts = Math.round(
        (graphNode.visit_count * graphNode.success_rate) / 100
      );
      const failedAttempts = graphNode.visit_count - successfulAttempts;

      setSelectedNode({
        stateName: nodeData.label,
        visitCount: nodeData.visit_count,
        successRate: nodeData.success_rate,
        status: nodeData.status,
        totalAttempts: graphNode.visit_count,
        successfulAttempts,
        failedAttempts,
      });
    },
    [graphData]
  );

  const clearSelectedNode = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return {
    graphData,
    isLoading,
    error,
    coverageStats,
    initialNodes,
    initialEdges,
    selectedNode,
    handleNodeClick,
    clearSelectedNode,
  };
}
