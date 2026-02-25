/**
 * Dependency Graph Visualization Component
 *
 * Main orchestrator that composes the graph canvas, controls, and analysis panel.
 * Manages all state, data flow, and coordination between sub-components.
 *
 * Features include:
 * - Color-coded nodes (green: leaf, blue: normal, red: circular, gray: unused)
 * - Multiple layout algorithms (hierarchical, force-directed, circular, tree)
 * - Analysis panel for circular dependencies, unused workflows, statistics
 * - Filtering by folder, tag, dependencies, dependents
 * - Search and highlight
 * - Export (PNG, SVG, JSON, GraphML, Markdown)
 * - Context menus
 * - Performance optimizations for large graphs
 */

"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertCircle,
  TrendingUp,
  EyeOff,
  X,
  BarChart3,
  Layers,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { ScrollArea } from "../../ui/scroll-area";
import { Separator } from "../../ui/separator";
import { cn } from "../../../lib/utils";
import {
  DependencyGraphProps,
  WorkflowNode,
  DependencyEdge,
  LayoutType,
  FilterType,
} from "./types";
import {
  buildDependencyMap,
  analyzeGraph,
  applyLayout,
  exportAsPNG,
  exportAsSVG,
  exportAsJSON,
  exportAsGraphML,
  exportAsMarkdown,
} from "./layout-engine";
import { useEdgeCreator } from "./EdgeRenderer";
import { GraphCanvas } from "./GraphCanvas";
import { GraphControls } from "./GraphControls";

// ============================================================================
// Inner Component (with ReactFlow context)
// ============================================================================

function DependencyGraphInner({
  workflows,
  selectedWorkflowId,
  onSelectWorkflow,
  onOpenWorkflow,
  className,
}: DependencyGraphProps) {
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

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className={cn("flex h-full", className)}>
      {/* Main graph area */}
      <GraphCanvas
        nodes={nodes as WorkflowNode[]}
        edges={edges as DependencyEdge[]}
        onNodesChange={onNodesChange as unknown as (changes: unknown[]) => void}
        onEdgesChange={onEdgesChange as unknown as (changes: unknown[]) => void}
        onNodeClick={
          handleNodeClick as unknown as (
            event: React.MouseEvent,
            node: unknown
          ) => void
        }
        onNodeDoubleClick={
          handleNodeDoubleClick as unknown as (
            event: React.MouseEvent,
            node: unknown
          ) => void
        }
        onNodeContextMenu={
          handleNodeContextMenu as unknown as (
            event: React.MouseEvent,
            node: unknown
          ) => void
        }
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

      {/* Analysis panel */}
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

// ============================================================================
// Analysis Panel (kept in orchestrator since it's tightly coupled to state)
// ============================================================================

function AnalysisPanel({
  analysis,
  workflows,
  onSelectWorkflow,
  onHighlightCircular,
  onClose,
}: {
  analysis: ReturnType<typeof analyzeGraph>;
  workflows: DependencyGraphProps["workflows"];
  onSelectWorkflow: (workflowId: string) => void;
  onHighlightCircular: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="w-80 border-l bg-background overflow-hidden flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Analysis
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Circular Dependencies */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                Circular Dependencies
              </h4>
              <Badge variant="destructive" className="text-xs">
                {analysis.circularDependencies.length}
              </Badge>
            </div>
            {analysis.circularDependencies.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No circular dependencies detected
              </p>
            ) : (
              <div className="space-y-2">
                {analysis.circularDependencies.map((circ, index) => (
                  <button
                    key={index}
                    className="w-full text-left p-2 rounded-md border bg-card hover:bg-accent transition-colors"
                    onClick={() => onHighlightCircular(index)}
                  >
                    <div className="text-xs font-medium mb-1">
                      Cycle {index + 1}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {circ.chain
                        .map(
                          (id) => workflows.find((w) => w.id === id)?.name || id
                        )
                        .slice(0, 3)
                        .join(" \u2192 ")}
                      {circ.chain.length > 3 && " ..."}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Unused Workflows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <EyeOff className="h-4 w-4 text-text-muted" />
                Unused Workflows
              </h4>
              <Badge variant="secondary" className="text-xs">
                {analysis.unusedWorkflows.length}
              </Badge>
            </div>
            {analysis.unusedWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All workflows are in use
              </p>
            ) : (
              <div className="space-y-1">
                {analysis.unusedWorkflows.slice(0, 5).map((id) => {
                  const workflow = workflows.find((w) => w.id === id);
                  return (
                    <button
                      key={id}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent"
                      onClick={() => onSelectWorkflow(id)}
                    >
                      {workflow?.name || id}
                    </button>
                  );
                })}
                {analysis.unusedWorkflows.length > 5 && (
                  <p className="text-xs text-muted-foreground px-2">
                    +{analysis.unusedWorkflows.length - 5} more
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Most Depended On */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600" />
                Most Depended On
              </h4>
            </div>
            {analysis.mostDependedOn.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data</p>
            ) : (
              <div className="space-y-1">
                {analysis.mostDependedOn.slice(0, 5).map((item) => {
                  const workflow = workflows.find(
                    (w) => w.id === item.workflowId
                  );
                  return (
                    <button
                      key={item.workflowId}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-accent flex items-center justify-between"
                      onClick={() => onSelectWorkflow(item.workflowId)}
                    >
                      <span className="truncate">
                        {workflow?.name || item.workflowId}
                      </span>
                      <Badge variant="secondary" className="text-xs ml-2">
                        {item.count}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          {/* Longest Chains */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Layers className="h-4 w-4 text-purple-600" />
                Longest Chains
              </h4>
            </div>
            {analysis.longestChains.length === 0 ? (
              <p className="text-xs text-muted-foreground">No chains</p>
            ) : (
              <div className="space-y-2">
                {analysis.longestChains.slice(0, 3).map((item, index) => (
                  <div
                    key={index}
                    className="p-2 rounded-md border bg-card text-xs"
                  >
                    <div className="font-medium mb-1">
                      Chain {index + 1} (Length: {item.length})
                    </div>
                    <div className="text-muted-foreground">
                      {item.chain
                        .map(
                          (id) => workflows.find((w) => w.id === id)?.name || id
                        )
                        .slice(0, 3)
                        .join(" \u2192 ")}
                      {item.chain.length > 3 && " ..."}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Statistics */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Statistics
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Workflows:</span>
                <span className="font-medium">{workflows.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Total Dependencies:
                </span>
                <span className="font-medium">
                  {analysis.totalDependencies}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Dependencies:</span>
                <span className="font-medium">
                  {analysis.avgDependencies.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Circular Deps:</span>
                <span className="font-medium text-red-600">
                  {analysis.circularDependencies.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unused:</span>
                <span className="font-medium text-text-muted">
                  {analysis.unusedWorkflows.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Main Component (Outer - provides ReactFlow context)
// ============================================================================

export function DependencyGraph(props: DependencyGraphProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
  );
}
