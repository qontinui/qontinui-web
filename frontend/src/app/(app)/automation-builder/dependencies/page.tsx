"use client";

import React, { useMemo, useCallback } from "react";
import { useDependenciesBridge } from "@/stores/page-state";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  Panel,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  NetworkIcon,
  GitBranch,
  AlertCircle,
  TrendingUp,
  BarChart3,
  Download,
  Search,
  Filter,
  RefreshCw,
  Trash2,
  Target,
  Zap,
  ArrowRight,
  ExternalLink,
  TestTube,
  BookOpen,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Info,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RequireProject } from "@/components/require-project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAutomation } from "@/contexts/automation-context";
import { workflowDependencyAnalyzer } from "@/services/workflow-dependency-analyzer";
import type {
  DependencyGraph,
  DependencyNode,
  DependencyStats,
  ImpactAnalysis,
} from "@/services/workflow-dependency-analyzer";
import type { Workflow } from "@/lib/action-schema/action-types";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

interface FilterState {
  folders: string[];
  tags: string[];
  categories: string[];
  showOnlyIssues: boolean;
  showCriticalPath: boolean;
  selectedWorkflowId: string | null;
  viewMode: "all" | "dependencies" | "dependents";
}

interface SelectedWorkflowData {
  workflow: Workflow;
  node: DependencyNode;
  impact: ImpactAnalysis;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getNodeColor(node: DependencyNode): string {
  if (node.isCircular) return "#ef4444"; // red - circular
  if (node.inDegree === 0) return "#10b981"; // green - leaf/unused
  if (node.inDegree >= 3) return "#f59e0b"; // amber - critical
  return "#3b82f6"; // blue - normal
}

function getImpactBadge(level: "low" | "medium" | "high" | "critical") {
  const variants = {
    low: { variant: "secondary" as const, label: "Low", icon: Info },
    medium: {
      variant: "default" as const,
      label: "Medium",
      icon: AlertTriangle,
    },
    high: { variant: "default" as const, label: "High", icon: AlertCircle },
    critical: {
      variant: "destructive" as const,
      label: "Critical",
      icon: AlertCircle,
    },
  };
  return variants[level];
}

// ============================================================================
// Main Component
// ============================================================================

function DependenciesPageInner() {
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
  const stats = useMemo<DependencyStats | null>(() => {
    if (workflows.length === 0) return null;
    return workflowDependencyAnalyzer.getDependencyStats(workflows);
  }, [workflows, graph]);

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

  // Filtered workflows
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
  }, [graph.cycles]);

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
  }, [unusedWorkflows]);

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

  // Show loading state during hydration
  if (isHydrating) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Workflow Dependencies</h1>
          <p className="text-muted-foreground mt-1">Loading saved state...</p>
        </div>
      </div>
    );
  }

  if (workflows.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Workflow Dependencies</h1>
          <p className="text-muted-foreground mt-1">
            Visualize and analyze workflow relationships
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <NetworkIcon className="size-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Workflows Found</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Create some workflows in the Automation Builder to see dependency
              analysis
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b bg-background p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <NetworkIcon className="size-8" />
              Workflow Dependencies
            </h1>
            <p className="text-muted-foreground mt-1">
              Visualize and analyze workflow relationships
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleAnalyzeAll}>
              <RefreshCw className="size-4" />
              Analyze All
            </Button>
            <Button variant="outline" size="sm" onClick={handleDetectCircular}>
              <AlertCircle className="size-4" />
              Detect Circular
            </Button>
            <Button variant="outline" size="sm" onClick={handleFindUnused}>
              <Trash2 className="size-4" />
              Find Unused
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportReport}>
              <Download className="size-4" />
              Export Report
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="default"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter className="size-4" />
            Filters
            {filtersOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
        </div>

        {/* Filters Panel */}
        {filtersOpen && (
          <Card>
            <CardContent className="py-4 space-y-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">
                    Category
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {["Main", "Helper", "Utility", "Test"].map((cat) => (
                      <Button
                        key={cat}
                        variant={
                          filters.categories.includes(cat)
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        onClick={() => {
                          setFilters((prev) => ({
                            ...prev,
                            categories: prev.categories.includes(cat)
                              ? prev.categories.filter((c) => c !== cat)
                              : [...prev.categories, cat],
                          }));
                        }}
                      >
                        {cat}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">
                    Options
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={filters.showOnlyIssues ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          showOnlyIssues: !prev.showOnlyIssues,
                        }))
                      }
                    >
                      <AlertCircle className="size-4" />
                      Only Issues
                    </Button>
                    <Button
                      variant={filters.showCriticalPath ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          showCriticalPath: !prev.showCriticalPath,
                        }))
                      }
                    >
                      <Target className="size-4" />
                      Critical Path
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column - Graph (70%) */}
        <div className="flex-1 relative border-r">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            fitView
            attributionPosition="bottom-left"
            className="bg-background"
          >
            <Background />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                const depNode = graph.nodes.get(node.id);
                return depNode ? getNodeColor(depNode) : "#3b82f6";
              }}
              className="bg-background border"
            />
            <Panel
              position="top-right"
              className="bg-background border rounded-lg p-3 m-4 space-y-2"
            >
              <div className="text-xs font-semibold mb-2">Legend</div>
              <div className="flex items-center gap-2 text-xs">
                <div className="size-3 rounded bg-[#3b82f6]" />
                <span>Normal</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="size-3 rounded bg-[#10b981]" />
                <span>Unused</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="size-3 rounded bg-[#f59e0b]" />
                <span>Critical</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="size-3 rounded bg-[#ef4444]" />
                <span>Circular</span>
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Right Column - Analysis Panel (30%) */}
        <div className="w-[400px] flex flex-col bg-background">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col"
          >
            <div className="border-b px-4 py-2">
              <TabsList className="w-full">
                <TabsTrigger value="overview" className="flex-1">
                  <BarChart3 className="size-4" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="circular" className="flex-1">
                  <GitBranch className="size-4" />
                  Circular
                </TabsTrigger>
                <TabsTrigger value="unused" className="flex-1">
                  <Trash2 className="size-4" />
                  Unused
                </TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1">
              {/* Overview Tab */}
              <TabsContent value="overview" className="p-4 space-y-4 m-0">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Statistics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Total Workflows
                      </span>
                      <span className="font-semibold">
                        {stats?.totalWorkflows || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Total Dependencies
                      </span>
                      <span className="font-semibold">
                        {stats?.totalDependencies || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Avg. Dependencies
                      </span>
                      <span className="font-semibold">
                        {stats?.avgDependenciesPerWorkflow.toFixed(1) || 0}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Max Depth</span>
                      <span className="font-semibold">
                        {stats?.maxDepth || 0}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Circular Dependencies
                      </span>
                      <Badge
                        variant={
                          graph.cycles.length > 0 ? "destructive" : "secondary"
                        }
                      >
                        {graph.cycles.length}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Unused Workflows
                      </span>
                      <Badge
                        variant={
                          unusedWorkflows.length > 0 ? "default" : "secondary"
                        }
                      >
                        {unusedWorkflows.length}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                {stats && stats.mostDepended.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">
                        Most Depended On
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {stats.mostDepended.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between text-sm"
                        >
                          <span className="truncate flex-1">{item.name}</span>
                          <Badge variant="secondary">{item.count}</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {stats && stats.mostDependencies.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">
                        Most Dependencies
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {stats.mostDependencies.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between text-sm"
                        >
                          <span className="truncate flex-1">{item.name}</span>
                          <Badge variant="secondary">{item.count}</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Circular Dependencies Tab */}
              <TabsContent value="circular" className="p-4 space-y-4 m-0">
                {graph.cycles.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <CheckCircle2 className="size-12 text-green-500 mb-4" />
                      <p className="text-sm text-muted-foreground text-center">
                        No circular dependencies found
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <AlertCircle className="size-4 text-destructive" />
                      <span className="font-semibold">
                        {graph.cycles.length} circular{" "}
                        {graph.cycles.length === 1
                          ? "dependency"
                          : "dependencies"}{" "}
                        detected
                      </span>
                    </div>
                    {graph.cycles.map((cycle, idx) => {
                      const workflowNames = cycle
                        .map(
                          (id) => workflows.find((w) => w.id === id)?.name || id
                        )
                        .slice(0, -1); // Remove duplicate last item
                      return (
                        <Card key={idx}>
                          <CardHeader>
                            <CardTitle className="text-sm flex items-center gap-2">
                              <GitBranch className="size-4" />
                              Cycle {idx + 1}
                              <Badge variant="destructive">
                                {workflowNames.length} workflows
                              </Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="text-xs space-y-1">
                              {workflowNames.map((name, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2"
                                >
                                  <span className="truncate">{name}</span>
                                  {i < workflowNames.length - 1 && (
                                    <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                                  )}
                                </div>
                              ))}
                              <div className="flex items-center gap-2 text-destructive">
                                <ArrowRight className="size-3 shrink-0" />
                                <span className="font-semibold">
                                  Back to {workflowNames[0]}
                                </span>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => handleHighlightCycle(cycle)}
                            >
                              <Target className="size-4" />
                              Highlight on Graph
                            </Button>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </>
                )}
              </TabsContent>

              {/* Unused Workflows Tab */}
              <TabsContent value="unused" className="p-4 space-y-4 m-0">
                {unusedWorkflows.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <CheckCircle2 className="size-12 text-green-500 mb-4" />
                      <p className="text-sm text-muted-foreground text-center">
                        All workflows are being used
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Info className="size-4 text-blue-500" />
                      <span className="font-semibold">
                        {unusedWorkflows.length} unused{" "}
                        {unusedWorkflows.length === 1
                          ? "workflow"
                          : "workflows"}
                      </span>
                    </div>
                    {unusedWorkflows.map((workflow) => {
                      const node = graph.nodes.get(workflow.id);
                      return (
                        <Card key={workflow.id}>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              {workflow.name}
                            </CardTitle>
                            {workflow.category && (
                              <CardDescription>
                                <Badge variant="outline">
                                  {workflow.category}
                                </Badge>
                              </CardDescription>
                            )}
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Actions
                                </span>
                                <span className="font-medium">
                                  {workflow.actions.length}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Dependencies
                                </span>
                                <span className="font-medium">
                                  {node?.outDegree || 0}
                                </span>
                              </div>
                            </div>
                            <Separator />
                            <div className="text-xs text-muted-foreground">
                              <p className="font-semibold mb-1">Suggestions:</p>
                              <ul className="list-disc list-inside space-y-0.5">
                                {workflow.category !== "Main" && (
                                  <li>
                                    Convert to Main category if useful
                                    standalone
                                  </li>
                                )}
                                <li>Delete if no longer needed</li>
                                <li>Add to test suite for verification</li>
                              </ul>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </>
                )}
              </TabsContent>

              {/* Critical Tab */}
              <TabsContent value="critical" className="p-4 space-y-4 m-0">
                {criticalWorkflows.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-8">
                      <Info className="size-12 text-blue-500 mb-4" />
                      <p className="text-sm text-muted-foreground text-center">
                        No critical workflows identified
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingUp className="size-4 text-orange-500" />
                      <span className="font-semibold">
                        {criticalWorkflows.length} critical{" "}
                        {criticalWorkflows.length === 1
                          ? "workflow"
                          : "workflows"}
                      </span>
                    </div>
                    {criticalWorkflows.map((workflow) => {
                      const node = graph.nodes.get(workflow.id)!;
                      const impact =
                        workflowDependencyAnalyzer.getImpactAnalysis(
                          workflow.id,
                          workflows
                        );
                      const impactBadge = getImpactBadge(impact.impactLevel);
                      const Icon = impactBadge.icon;

                      return (
                        <Card key={workflow.id}>
                          <CardHeader>
                            <CardTitle className="text-sm flex items-center justify-between">
                              <span className="truncate">{workflow.name}</span>
                              <Badge variant={impactBadge.variant}>
                                <Icon className="size-3" />
                                {impactBadge.label}
                              </Badge>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="text-xs space-y-1">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Dependents
                                </span>
                                <span className="font-medium">
                                  {node.inDegree}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  Impact
                                </span>
                                <span className="font-medium">
                                  {impact.affectedCount} workflows affected
                                </span>
                              </div>
                            </div>
                            <Separator />
                            <div className="text-xs text-muted-foreground">
                              <p className="font-semibold mb-1">
                                Recommendations:
                              </p>
                              <ul className="list-disc list-inside space-y-0.5">
                                <li>Add comprehensive tests</li>
                                <li>Document expected behavior</li>
                                <li>
                                  Consider breaking into smaller workflows
                                </li>
                                <li>Monitor execution carefully</li>
                              </ul>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>
      </div>

      {/* Selected Workflow Bottom Sheet */}
      {selectedWorkflow && (
        <div className="border-t bg-background p-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">
                  {selectedWorkflow.workflow.name}
                </h3>
                {selectedWorkflow.node.isCircular && (
                  <Badge variant="destructive">
                    <AlertCircle className="size-3" />
                    Circular
                  </Badge>
                )}
                {selectedWorkflow.impact.impactLevel === "critical" && (
                  <Badge variant="destructive">
                    <Zap className="size-3" />
                    Critical
                  </Badge>
                )}
              </div>
              {selectedWorkflow.workflow.category && (
                <Badge variant="outline">
                  {selectedWorkflow.workflow.category}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedWorkflowId(null)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {/* Quick Stats */}
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {selectedWorkflow.workflow.actions.length}
                  </div>
                  <div className="text-xs text-muted-foreground">Actions</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {selectedWorkflow.node.outDegree}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Dependencies
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {selectedWorkflow.node.inDegree}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Dependents
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <div className="text-2xl font-bold">
                    {selectedWorkflow.impact.affectedCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Impact</div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="outline">
              <ExternalLink className="size-4" />
              Open in Editor
            </Button>
            <Button size="sm" variant="outline">
              <BarChart3 className="size-4" />
              View Metrics
            </Button>
            <Button size="sm" variant="outline">
              <TestTube className="size-4" />
              Run Tests
            </Button>
            <Button size="sm" variant="outline">
              <BookOpen className="size-4" />
              Documentation
            </Button>
          </div>
        </div>
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
