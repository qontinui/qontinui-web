"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  NodeMouseHandler,
} from "@xyflow/react";
import { Workflow } from "../../../../lib/action-schema/action-types";
import { WorkflowNode, DependencyEdge, LayoutType, FilterType } from "../types";
import {
  buildDependencyMap,
  analyzeGraph,
  applyLayout,
  exportAsPNG,
  exportAsSVG,
  exportAsJSON,
  exportAsGraphML,
  exportAsMarkdown,
} from "../layout-engine";
import { useEdgeCreator } from "../EdgeRenderer";

interface UseDependencyGraphParams {
  workflows: Workflow[];
  selectedWorkflowId?: string;
  onSelectWorkflow: (workflowId: string) => void;
  onOpenWorkflow: (workflowId: string) => void;
}

export function useDependencyGraph({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onOpenWorkflow,
}: UseDependencyGraphParams) {
  const reactFlowInstance = useReactFlow();

  // State
  const [layout, setLayout] = useState<LayoutType>("hierarchical");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState<FilterType>("all");
  const [hideUnused] = useState(false);
  const [highlightedWorkflows, setHighlightedWorkflows] = useState<Set<string>>(
    new Set()
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    workflowId: string;
  } | null>(null);

  // Build dependency map
  const dependencyMap = useMemo(
    () => buildDependencyMap(workflows),
    [workflows]
  );

  // Analyze graph
  const analysis = useMemo(
    () => analyzeGraph(workflows, dependencyMap),
    [workflows, dependencyMap]
  );

  // Get circular workflow IDs for highlighting
  const circularWorkflowIds = useMemo(() => {
    const ids = new Set<string>();
    analysis.circularDependencies.forEach((circ) => {
      circ.workflows.forEach((id) => ids.add(id));
    });
    return ids;
  }, [analysis.circularDependencies]);

  // Edge creator hook
  const createEdges = useEdgeCreator({
    dependencyMap,
    workflows,
    highlightedWorkflows,
  });

  // Convert workflows to nodes
  const createNodes = useCallback((): WorkflowNode[] => {
    let filteredWorkflows = workflows;

    // Apply filters
    if (hideUnused) {
      filteredWorkflows = filteredWorkflows.filter(
        (w) => !analysis.unusedWorkflows.includes(w.id)
      );
    }

    if (selectedFilter === "dependencies" && selectedWorkflowId) {
      const info = dependencyMap.get(selectedWorkflowId);
      const relevantIds = new Set([
        selectedWorkflowId,
        ...(info?.dependencies || []),
      ]);
      filteredWorkflows = filteredWorkflows.filter((w) =>
        relevantIds.has(w.id)
      );
    } else if (selectedFilter === "dependents" && selectedWorkflowId) {
      const info = dependencyMap.get(selectedWorkflowId);
      const relevantIds = new Set([
        selectedWorkflowId,
        ...(info?.dependents || []),
      ]);
      filteredWorkflows = filteredWorkflows.filter((w) =>
        relevantIds.has(w.id)
      );
    } else if (selectedFilter === "unused") {
      filteredWorkflows = filteredWorkflows.filter((w) =>
        analysis.unusedWorkflows.includes(w.id)
      );
    } else if (selectedFilter === "critical") {
      const criticalIds = new Set(
        analysis.mostDependedOn.slice(0, 10).map((item) => item.workflowId)
      );
      filteredWorkflows = filteredWorkflows.filter((w) =>
        criticalIds.has(w.id)
      );
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredWorkflows = filteredWorkflows.filter((w) =>
        w.name.toLowerCase().includes(query)
      );
    }

    return filteredWorkflows.map((workflow) => {
      const info = dependencyMap.get(workflow.id)!;
      const isCircular = circularWorkflowIds.has(workflow.id);
      const isUnused = analysis.unusedWorkflows.includes(workflow.id);
      const isLeaf =
        info.dependencies.length === 0 && info.dependents.length > 0;

      return {
        id: workflow.id,
        type: "workflow",
        position: { x: 0, y: 0 }, // Will be set by layout
        data: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          dependencyCount: info.dependencies.length,
          dependentCount: info.dependents.length,
          isCircular,
          isUnused,
          isLeaf,
          tags: workflow.tags,
          folder: workflow.category,
        },
        selected: workflow.id === selectedWorkflowId,
      };
    });
  }, [
    workflows,
    dependencyMap,
    analysis,
    circularWorkflowIds,
    selectedWorkflowId,
    selectedFilter,
    hideUnused,
    searchQuery,
  ]);

  // Apply layout wrapper
  const applyCurrentLayout = useCallback(
    (nodes: WorkflowNode[], edges: DependencyEdge[]): WorkflowNode[] => {
      return applyLayout(layout, nodes, edges);
    },
    [layout]
  );

  // Create and layout nodes
  const initialNodes = useMemo(() => {
    const nodes = createNodes();
    const edges = createEdges(nodes);
    return applyCurrentLayout(nodes, edges);
  }, [createNodes, createEdges, applyCurrentLayout]);

  const initialEdges = useMemo(() => {
    const nodes = createNodes();
    return createEdges(nodes);
  }, [createNodes, createEdges]);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<DependencyEdge>(initialEdges);

  // Update nodes and edges when dependencies change
  useEffect(() => {
    const newNodes = createNodes();
    const newEdges = createEdges(newNodes);
    const layoutedNodes = applyCurrentLayout(newNodes, newEdges);
    setNodes(layoutedNodes);
    setEdges(newEdges);
  }, [createNodes, createEdges, applyCurrentLayout, setNodes, setEdges]);

  // Fit view when nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
      }, 50);
    }
  }, [nodes.length, reactFlowInstance]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onSelectWorkflow(node.id);
    },
    [onSelectWorkflow]
  );

  const handleNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onOpenWorkflow(node.id);
    },
    [onOpenWorkflow]
  );

  const handleNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      workflowId: node.id,
    });
  }, []);

  const handleFitView = useCallback(() => {
    reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
  }, [reactFlowInstance]);

  const handleZoomIn = useCallback(() => {
    reactFlowInstance.zoomIn({ duration: 300 });
  }, [reactFlowInstance]);

  const handleZoomOut = useCallback(() => {
    reactFlowInstance.zoomOut({ duration: 300 });
  }, [reactFlowInstance]);

  const handleCenterOnSelected = useCallback(() => {
    if (selectedWorkflowId) {
      const node = nodes.find((n) => n.id === selectedWorkflowId);
      if (node) {
        reactFlowInstance.setCenter(
          node.position.x + 90,
          node.position.y + 30,
          { zoom: 1.5, duration: 300 }
        );
      }
    }
  }, [selectedWorkflowId, nodes, reactFlowInstance]);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (query) {
        const matchingWorkflow = workflows.find((w) =>
          w.name.toLowerCase().includes(query.toLowerCase())
        );
        if (matchingWorkflow) {
          onSelectWorkflow(matchingWorkflow.id);
          setHighlightedWorkflows(new Set([matchingWorkflow.id]));
        }
      } else {
        setHighlightedWorkflows(new Set());
      }
    },
    [workflows, onSelectWorkflow]
  );

  const handleHighlightCircular = useCallback(
    (index: number) => {
      const circular = analysis.circularDependencies[index];
      if (circular) {
        setHighlightedWorkflows(circular.workflows);
      }
    },
    [analysis.circularDependencies]
  );

  const handleExport = useCallback(
    (format: string) => {
      switch (format) {
        case "png":
          exportAsPNG(reactFlowInstance);
          break;
        case "svg":
          exportAsSVG(nodes as WorkflowNode[], edges as DependencyEdge[]);
          break;
        case "json":
          exportAsJSON(workflows, dependencyMap);
          break;
        case "graphml":
          exportAsGraphML(workflows, dependencyMap);
          break;
        case "markdown":
          exportAsMarkdown(workflows, dependencyMap, analysis);
          break;
      }
    },
    [reactFlowInstance, nodes, edges, workflows, dependencyMap, analysis]
  );

  const handleShowDependencies = useCallback(
    (workflowId: string) => {
      const info = dependencyMap.get(workflowId);
      if (info?.dependencies) {
        setHighlightedWorkflows(new Set([workflowId, ...info.dependencies]));
      }
    },
    [dependencyMap]
  );

  const handleShowDependents = useCallback(
    (workflowId: string) => {
      const info = dependencyMap.get(workflowId);
      if (info?.dependents) {
        setHighlightedWorkflows(new Set([workflowId, ...info.dependents]));
      }
    },
    [dependencyMap]
  );

  return {
    // State
    nodes: nodes as WorkflowNode[],
    edges: edges as DependencyEdge[],
    layout,
    searchQuery,
    showAnalysis,
    selectedFilter,
    contextMenu,
    analysis,

    // State setters
    setLayout,
    setSelectedFilter,
    setShowAnalysis,
    setContextMenu,

    // Change handlers (ReactFlow)
    onNodesChange: onNodesChange as unknown as (changes: unknown[]) => void,
    onEdgesChange: onEdgesChange as unknown as (changes: unknown[]) => void,

    // Event handlers
    handleNodeClick: handleNodeClick as unknown as (
      event: React.MouseEvent,
      node: unknown
    ) => void,
    handleNodeDoubleClick: handleNodeDoubleClick as unknown as (
      event: React.MouseEvent,
      node: unknown
    ) => void,
    handleNodeContextMenu: handleNodeContextMenu as unknown as (
      event: React.MouseEvent,
      node: unknown
    ) => void,
    handleFitView,
    handleZoomIn,
    handleZoomOut,
    handleCenterOnSelected,
    handleSearch,
    handleHighlightCircular,
    handleExport,
    handleShowDependencies,
    handleShowDependents,
  };
}
