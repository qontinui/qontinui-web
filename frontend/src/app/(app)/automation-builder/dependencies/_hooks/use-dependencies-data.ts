import React, { useMemo, useCallback } from "react";
import { useDependenciesBridge } from "@/stores/page-state";
import {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "@xyflow/react";
import { useAutomation } from "@/contexts/automation-context";
import {
  workflowDependencyAnalyzer,
  type DependencyGraph,
  type DependencyStats,
} from "@/services/workflow-dependency-analyzer";
import { toast } from "sonner";
import {
  type FilterState,
  type SelectedWorkflowData,
  getNodeColor,
} from "../dependencies-types";

export function useDependenciesData() {
  const { workflows = [] } = useAutomation();

  // Use bridge hook for persisted state
  const {
    isHydrating,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    filtersOpen,
    setFiltersOpen,
    filters: persistedFilters,
    setFilters: setPersistedFilters,
    selectedWorkflowId,
    setSelectedWorkflowId,
  } = useDependenciesBridge();

  // Local non-persisted state (selectedWorkflow is derived from selectedWorkflowId)
  const selectedWorkflow = useMemo<SelectedWorkflowData | null>(() => {
    if (!selectedWorkflowId) return null;
    const workflow = workflows.find((w) => w.id === selectedWorkflowId);
    if (!workflow) return null;

    // Build the graph to get the node
    const graph = workflowDependencyAnalyzer.buildDependencyGraph(workflows);
    const depNode = graph.nodes.get(selectedWorkflowId);
    if (!depNode) return null;

    const impact = workflowDependencyAnalyzer.getImpactAnalysis(
      selectedWorkflowId,
      workflows
    );

    return {
      workflow,
      node: depNode,
      impact,
    };
  }, [selectedWorkflowId, workflows]);

  // Convert persisted filters to FilterState format (add non-persisted fields)
  const filters: FilterState = useMemo(
    () => ({
      folders: persistedFilters.folders,
      tags: persistedFilters.tags,
      categories: persistedFilters.categories,
      showOnlyIssues: false,
      showCriticalPath: false,
      selectedWorkflowId: selectedWorkflowId,
      viewMode: "all" as const,
    }),
    [persistedFilters, selectedWorkflowId]
  );

  // Wrapper for setFilters to handle both persisted and non-persisted fields
  const setFilters = useCallback(
    (update: Partial<FilterState> | ((prev: FilterState) => FilterState)) => {
      const newFilters =
        typeof update === "function"
          ? update(filters)
          : { ...filters, ...update };

      // Update persisted fields (note: persistedFilters.viewMode is separate from FilterState.viewMode)
      setPersistedFilters({
        folders: newFilters.folders,
        tags: newFilters.tags,
        categories: newFilters.categories,
        // Keep the persisted viewMode as-is (it's for graph vs list, not all/dependencies/dependents)
      });

      // Update selectedWorkflowId if it changed
      if (newFilters.selectedWorkflowId !== selectedWorkflowId) {
        setSelectedWorkflowId(newFilters.selectedWorkflowId);
      }
    },
    [filters, setPersistedFilters, selectedWorkflowId, setSelectedWorkflowId]
  );

  // Build dependency graph
  const graph = useMemo<DependencyGraph>(() => {
    if (workflows.length === 0) {
      return {
        nodes: new Map(),
        edges: [],
        cycles: [],
        roots: [],
        leaves: [],
        timestamp: Date.now(),
      };
    }
    return workflowDependencyAnalyzer.buildDependencyGraph(workflows);
  }, [workflows]);

  // Get statistics
  // Note: graph is intentionally excluded from deps - we compute stats from workflows directly
  const stats = useMemo<DependencyStats | null>(() => {
    if (workflows.length === 0) return null;
    return workflowDependencyAnalyzer.getDependencyStats(workflows);
  }, [workflows]);

  // Get visualization data
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (workflows.length === 0) {
      return { nodes: [], edges: [] };
    }
    const vizData = workflowDependencyAnalyzer.getNodesAndEdges(workflows);

    // Convert to React Flow format with proper typing
    const nodes: Node[] = vizData.nodes.map((n) => {
      const node = graph.nodes.get(n.id);
      return {
        id: n.id,
        type: "default",
        position: n.position,
        data: {
          ...n.data,
          label: n.data.label,
        },
        style: {
          background: getNodeColor(node!),
          color: "white",
          border: "2px solid #666",
          borderRadius: "8px",
          padding: "10px",
          fontSize: "12px",
          fontWeight: 500,
        },
      };
    });

    const edges: Edge[] = vizData.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "default",
      animated: e.animated || false,
      label: e.label,
      style: {
        stroke: e.data?.isCyclic ? "#ef4444" : "#666",
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: e.data?.isCyclic ? "#ef4444" : "#666",
      },
    }));

    return { nodes, edges };
  }, [workflows, graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when graph changes
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Get unused workflows
  const unusedWorkflows = useMemo(() => {
    const unused = workflowDependencyAnalyzer.findUnusedWorkflows(workflows);
    return workflows.filter((w) => unused.includes(w.id));
  }, [workflows]);

  // Get critical workflows (most depended on)
  const criticalWorkflows = useMemo(() => {
    const critical = Array.from(graph.nodes.values())
      .filter((n) => n.inDegree >= 2)
      .sort((a, b) => b.inDegree - a.inDegree)
      .slice(0, 10);
    return critical
      .map((n) => workflows.find((w) => w.id === n.id)!)
      .filter(Boolean);
  }, [graph, workflows]);

  // Handle node click
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedWorkflowId(node.id);
    },
    [setSelectedWorkflowId]
  );

  // Export functions
  const handleExportReport = useCallback(() => {
    const report = workflowDependencyAnalyzer.exportDependencyReport(workflows);
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-dependencies-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Dependency report exported");
  }, [workflows]);

  const handleAnalyzeAll = useCallback(() => {
    workflowDependencyAnalyzer.invalidateCache();
    toast.success("Dependency analysis refreshed");
  }, []);

  const handleDetectCircular = useCallback(() => {
    const cycles = graph.cycles;
    if (cycles.length === 0) {
      toast.success("No circular dependencies found");
    } else {
      toast.warning(`Found ${cycles.length} circular dependencies`, {
        description: "View the Circular Dependencies tab for details",
      });
      setActiveTab("circular");
    }
  }, [graph.cycles, setActiveTab]);

  const handleFindUnused = useCallback(() => {
    const unused = unusedWorkflows.length;
    if (unused === 0) {
      toast.success("No unused workflows found");
    } else {
      toast.info(`Found ${unused} unused workflows`, {
        description: "View the Unused Workflows tab for details",
      });
      setActiveTab("unused");
    }
  }, [unusedWorkflows, setActiveTab]);

  const handleHighlightCycle = useCallback(
    (cycle: string[]) => {
      // Highlight nodes in the cycle
      const highlightedNodes = nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          border: cycle.includes(node.id)
            ? "3px solid #ef4444"
            : node.style?.border,
          boxShadow: cycle.includes(node.id) ? "0 0 10px #ef4444" : undefined,
        },
      }));
      setNodes(highlightedNodes);
    },
    [nodes, setNodes]
  );

  return {
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
    selectedWorkflowId,
    setSelectedWorkflowId,

    // Handlers
    handleNodeClick,
    handleExportReport,
    handleAnalyzeAll,
    handleDetectCircular,
    handleFindUnused,
    handleHighlightCycle,
  };
}
