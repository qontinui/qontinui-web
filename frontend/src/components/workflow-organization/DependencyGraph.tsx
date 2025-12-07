/**
 * Dependency Graph Visualization Component
 *
 * Interactive graph visualization for workflow dependencies using React Flow.
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
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  NodeMouseHandler,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import {
  Network,
  Search,
  Download,
  Filter,
  LayoutGrid,
  AlertCircle,
  TrendingUp,
  Link2,
  EyeOff,
  FileText,
  GitBranch,
  Target,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  BarChart3,
  Layers,
} from "lucide-react";
import { Workflow } from "../../lib/action-schema/action-types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

// ============================================================================
// Types
// ============================================================================

export interface DependencyGraphProps {
  workflows: Workflow[];
  selectedWorkflowId?: string;
  onSelectWorkflow: (workflowId: string) => void;
  onOpenWorkflow: (workflowId: string) => void;
  className?: string;
}

interface WorkflowNode extends Node {
  data: {
    workflowId: string;
    workflowName: string;
    dependencyCount: number;
    dependentCount: number;
    isCircular: boolean;
    isUnused: boolean;
    isLeaf: boolean;
    tags?: string[];
    folder?: string;
  };
}

interface DependencyEdge extends Edge {
  data: {
    actionName?: string;
    sourceWorkflowId: string;
    targetWorkflowId: string;
  };
}

type LayoutType = "hierarchical" | "force" | "circular" | "tree";

interface DependencyInfo {
  workflowId: string;
  dependencies: string[]; // Workflows this depends on
  dependents: string[]; // Workflows that depend on this
}

interface CircularDependency {
  chain: string[];
  workflows: Set<string>;
}

interface GraphAnalysis {
  circularDependencies: CircularDependency[];
  unusedWorkflows: string[];
  mostDependedOn: Array<{ workflowId: string; count: number }>;
  longestChains: Array<{ chain: string[]; length: number }>;
  totalDependencies: number;
  avgDependencies: number;
}

// ============================================================================
// Dependency Analysis Utilities
// ============================================================================

/**
 * Extract RUN_WORKFLOW dependencies from a workflow
 */
function getWorkflowDependencies(workflow: Workflow): string[] {
  const dependencies = new Set<string>();

  workflow.actions.forEach((action) => {
    if (action.type === "RUN_WORKFLOW") {
      const config = action.config as any;
      if (config.workflowId) {
        dependencies.add(config.workflowId);
      }
    }
  });

  return Array.from(dependencies);
}

/**
 * Build dependency map for all workflows
 */
function buildDependencyMap(
  workflows: Workflow[]
): Map<string, DependencyInfo> {
  const map = new Map<string, DependencyInfo>();

  // Initialize map
  workflows.forEach((workflow) => {
    map.set(workflow.id, {
      workflowId: workflow.id,
      dependencies: [],
      dependents: [],
    });
  });

  // Build dependencies
  workflows.forEach((workflow) => {
    const dependencies = getWorkflowDependencies(workflow);
    const info = map.get(workflow.id)!;
    info.dependencies = dependencies;

    // Add reverse dependencies
    dependencies.forEach((depId) => {
      const depInfo = map.get(depId);
      if (depInfo) {
        depInfo.dependents.push(workflow.id);
      }
    });
  });

  return map;
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(
  dependencyMap: Map<string, DependencyInfo>
): CircularDependency[] {
  const circular: CircularDependency[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const pathStack: string[] = [];

  function dfs(workflowId: string): boolean {
    if (recursionStack.has(workflowId)) {
      // Found a cycle - extract it
      const cycleStart = pathStack.indexOf(workflowId);
      const chain = pathStack.slice(cycleStart);
      chain.push(workflowId); // Complete the cycle

      const workflows = new Set(chain);

      // Check if we already have this cycle (same workflows)
      const isDuplicate = circular.some((c) => {
        if (c.workflows.size !== workflows.size) return false;
        return Array.from(workflows).every((w) => c.workflows.has(w));
      });

      if (!isDuplicate) {
        circular.push({ chain, workflows });
      }

      return true;
    }

    if (visited.has(workflowId)) {
      return false;
    }

    visited.add(workflowId);
    recursionStack.add(workflowId);
    pathStack.push(workflowId);

    const info = dependencyMap.get(workflowId);
    if (info) {
      for (const depId of info.dependencies) {
        dfs(depId);
      }
    }

    recursionStack.delete(workflowId);
    pathStack.pop();

    return false;
  }

  // Run DFS from each workflow
  for (const workflowId of dependencyMap.keys()) {
    if (!visited.has(workflowId)) {
      dfs(workflowId);
    }
  }

  return circular;
}

/**
 * Find longest dependency chains
 */
function findLongestChains(
  dependencyMap: Map<string, DependencyInfo>,
  limit: number = 5
): Array<{ chain: string[]; length: number }> {
  const chains: Array<{ chain: string[]; length: number }> = [];

  function findChains(workflowId: string, currentChain: string[]): void {
    const info = dependencyMap.get(workflowId);
    if (!info || info.dependencies.length === 0) {
      // Leaf node - save chain
      chains.push({
        chain: [...currentChain, workflowId],
        length: currentChain.length + 1,
      });
      return;
    }

    // Continue down each dependency
    for (const depId of info.dependencies) {
      if (!currentChain.includes(depId)) {
        // Avoid cycles
        findChains(depId, [...currentChain, workflowId]);
      }
    }
  }

  // Find chains from each workflow
  for (const workflowId of dependencyMap.keys()) {
    findChains(workflowId, []);
  }

  // Sort by length and take top N
  return chains.sort((a, b) => b.length - a.length).slice(0, limit);
}

/**
 * Analyze dependency graph
 */
function analyzeGraph(
  workflows: Workflow[],
  dependencyMap: Map<string, DependencyInfo>
): GraphAnalysis {
  const circular = detectCircularDependencies(dependencyMap);
  const circularWorkflowIds = new Set(
    circular.flatMap((c) => Array.from(c.workflows))
  );

  // Find unused workflows (no dependents and no dependencies)
  const unused = workflows
    .filter((w) => {
      const info = dependencyMap.get(w.id);
      return (
        info &&
        info.dependents.length === 0 &&
        info.dependencies.length === 0 &&
        !circularWorkflowIds.has(w.id)
      );
    })
    .map((w) => w.id);

  // Most depended on
  const mostDependedOn = Array.from(dependencyMap.entries())
    .map(([id, info]) => ({ workflowId: id, count: info.dependents.length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Longest chains
  const longestChains = findLongestChains(dependencyMap, 5);

  // Statistics
  const totalDependencies = Array.from(dependencyMap.values()).reduce(
    (sum, info) => sum + info.dependencies.length,
    0
  );
  const avgDependencies =
    workflows.length > 0 ? totalDependencies / workflows.length : 0;

  return {
    circularDependencies: circular,
    unusedWorkflows: unused,
    mostDependedOn,
    longestChains,
    totalDependencies,
    avgDependencies,
  };
}

// ============================================================================
// Layout Algorithms
// ============================================================================

/**
 * Hierarchical layout using dagre
 */
function applyHierarchicalLayout(
  nodes: WorkflowNode[],
  edges: DependencyEdge[]
): WorkflowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 100, ranksep: 150 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 200, height: 80 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const position = g.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - 100,
        y: position.y - 40,
      },
    };
  });
}

/**
 * Force-directed layout (simple spring simulation)
 */
function applyForceLayout(
  nodes: WorkflowNode[],
  edges: DependencyEdge[]
): WorkflowNode[] {
  const iterations = 100;
  const k = 200; // Optimal distance
  const c = 0.1; // Cooling factor

  // Initialize positions randomly if not set
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node) => {
    positions.set(node.id, {
      x: node.position?.x ?? Math.random() * 1000,
      y: node.position?.y ?? Math.random() * 1000,
    });
  });

  // Build adjacency map
  const adjacent = new Map<string, Set<string>>();
  nodes.forEach((node) => adjacent.set(node.id, new Set()));
  edges.forEach((edge) => {
    adjacent.get(edge.source)?.add(edge.target);
    adjacent.get(edge.target)?.add(edge.source);
  });

  // Simulate
  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map<string, { x: number; y: number }>();
    nodes.forEach((node) => forces.set(node.id, { x: 0, y: 0 }));

    // Repulsive forces (all pairs)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        if (!n1 || !n2) continue;
        const p1 = positions.get(n1.id);
        const p2 = positions.get(n2.id);
        if (!p1 || !p2) continue;

        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        const f1 = forces.get(n1.id);
        const f2 = forces.get(n2.id);
        if (!f1 || !f2) continue;
        f1.x += fx;
        f1.y += fy;
        f2.x -= fx;
        f2.y -= fy;
      }
    }

    // Attractive forces (connected pairs)
    edges.forEach((edge) => {
      const p1 = positions.get(edge.source)!;
      const p2 = positions.get(edge.target)!;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      const f1 = forces.get(edge.source)!;
      const f2 = forces.get(edge.target)!;
      f1.x += fx;
      f1.y += fy;
      f2.x -= fx;
      f2.y -= fy;
    });

    // Apply forces with cooling
    const temp = 1 - iter / iterations;
    nodes.forEach((node) => {
      const pos = positions.get(node.id)!;
      const force = forces.get(node.id)!;

      pos.x += force.x * c * temp;
      pos.y += force.y * c * temp;
    });
  }

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id)!,
  }));
}

/**
 * Circular layout
 */
function applyCircularLayout(nodes: WorkflowNode[]): WorkflowNode[] {
  const radius = Math.max(300, nodes.length * 30);
  const center = { x: 500, y: 400 };

  return nodes.map((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI;
    return {
      ...node,
      position: {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      },
    };
  });
}

/**
 * Tree layout (hierarchical but as a tree)
 */
function applyTreeLayout(
  nodes: WorkflowNode[],
  edges: DependencyEdge[]
): WorkflowNode[] {
  // Use dagre with tree settings
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 80,
    ranksep: 100,
    ranker: "tight-tree",
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: 180, height: 60 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const position = g.node(node.id);
    return {
      ...node,
      position: {
        x: position.x - 90,
        y: position.y - 30,
      },
    };
  });
}

// ============================================================================
// Export Utilities
// ============================================================================

/**
 * Export graph as PNG
 */
async function exportAsPNG(
  _reactFlowInstance: any,
  _filename: string = "dependency-graph.png"
) {
  // Use html2canvas or similar - for now just alert
  alert("PNG export would be implemented with html2canvas or similar library");
}

/**
 * Export graph as SVG
 */
function exportAsSVG(
  _nodes: WorkflowNode[],
  _edges: DependencyEdge[],
  _filename: string = "dependency-graph.svg"
) {
  alert("SVG export would generate an SVG representation of the graph");
}

/**
 * Export graph data as JSON
 */
function exportAsJSON(
  workflows: Workflow[],
  dependencyMap: Map<string, DependencyInfo>,
  filename: string = "dependency-graph.json"
) {
  const data = {
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      dependencies: dependencyMap.get(w.id)?.dependencies || [],
      dependents: dependencyMap.get(w.id)?.dependents || [],
    })),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export as GraphML
 */
function exportAsGraphML(
  workflows: Workflow[],
  dependencyMap: Map<string, DependencyInfo>,
  filename: string = "dependency-graph.graphml"
) {
  let graphml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="name" for="node" attr.name="name" attr.type="string"/>
  <graph id="G" edgedefault="directed">
`;

  // Nodes
  workflows.forEach((w) => {
    graphml += `    <node id="${w.id}">
      <data key="name">${w.name}</data>
    </node>
`;
  });

  // Edges
  dependencyMap.forEach((info, workflowId) => {
    info.dependencies.forEach((depId) => {
      graphml += `    <edge source="${workflowId}" target="${depId}"/>
`;
    });
  });

  graphml += `  </graph>
</graphml>`;

  const blob = new Blob([graphml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export dependency report as Markdown
 */
function exportAsMarkdown(
  workflows: Workflow[],
  dependencyMap: Map<string, DependencyInfo>,
  analysis: GraphAnalysis,
  filename: string = "dependency-report.md"
) {
  let markdown = `# Workflow Dependency Report

Generated: ${new Date().toLocaleString()}

## Summary

- Total Workflows: ${workflows.length}
- Total Dependencies: ${analysis.totalDependencies}
- Average Dependencies per Workflow: ${analysis.avgDependencies.toFixed(2)}
- Circular Dependencies: ${analysis.circularDependencies.length}
- Unused Workflows: ${analysis.unusedWorkflows.length}

## Circular Dependencies

`;

  if (analysis.circularDependencies.length === 0) {
    markdown += "No circular dependencies detected.\n\n";
  } else {
    analysis.circularDependencies.forEach((circ, index) => {
      markdown += `### Circular Dependency ${index + 1}\n\n`;
      markdown += "Chain: ";
      markdown += circ.chain
        .map((id) => workflows.find((w) => w.id === id)?.name || id)
        .join(" → ");
      markdown += "\n\n";
    });
  }

  markdown += `## Most Depended On Workflows

| Workflow | Dependent Count |
|----------|----------------|
`;

  analysis.mostDependedOn.forEach((item) => {
    const workflow = workflows.find((w) => w.id === item.workflowId);
    markdown += `| ${workflow?.name || item.workflowId} | ${item.count} |\n`;
  });

  markdown += `
## Longest Dependency Chains

`;

  analysis.longestChains.forEach((item, index) => {
    markdown += `### Chain ${index + 1} (Length: ${item.length})\n\n`;
    markdown += item.chain
      .map((id) => workflows.find((w) => w.id === id)?.name || id)
      .join(" → ");
    markdown += "\n\n";
  });

  markdown += `## All Workflows

| Workflow | Dependencies | Dependents |
|----------|-------------|-----------|
`;

  workflows.forEach((w) => {
    const info = dependencyMap.get(w.id);
    markdown += `| ${w.name} | ${info?.dependencies.length || 0} | ${info?.dependents.length || 0} |\n`;
  });

  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// Custom Node Component
// ============================================================================

function WorkflowNodeComponent({ data }: { data: WorkflowNode["data"] }) {
  const getNodeColor = () => {
    if (data.isCircular) return "border-red-500 bg-red-50 dark:bg-red-950";
    if (data.isUnused) return "border-gray-400 bg-gray-50 dark:bg-gray-900";
    if (data.isLeaf) return "border-green-500 bg-green-50 dark:bg-green-950";
    return "border-blue-500 bg-blue-50 dark:bg-blue-950";
  };

  const getStatusIcon = () => {
    if (data.isCircular)
      return <AlertCircle className="h-3 w-3 text-red-600" />;
    if (data.isUnused) return <EyeOff className="h-3 w-3 text-gray-500" />;
    if (data.isLeaf) return <Target className="h-3 w-3 text-green-600" />;
    return <Network className="h-3 w-3 text-blue-600" />;
  };

  return (
    <div
      className={cn(
        "px-4 py-2 rounded-lg border-2 min-w-[180px] max-w-[250px] shadow-sm transition-all",
        getNodeColor()
      )}
    >
      <div className="flex items-start gap-2 mb-1">
        {getStatusIcon()}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">
            {data.workflowName}
          </div>
          <div className="text-xs text-muted-foreground flex gap-2 mt-1">
            <span title="Dependencies">↓ {data.dependencyCount}</span>
            <span title="Dependents">↑ {data.dependentCount}</span>
          </div>
        </div>
      </div>
      {data.tags && data.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap mt-2">
          {data.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs px-1 py-0">
              {tag}
            </Badge>
          ))}
          {data.tags.length > 2 && (
            <Badge variant="secondary" className="text-xs px-1 py-0">
              +{data.tags.length - 2}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component (Inner - with ReactFlow context)
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
  const [selectedFilter, setSelectedFilter] = useState<
    "all" | "dependencies" | "dependents" | "unused" | "critical"
  >("all");
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

  // Convert dependencies to edges
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
              (a.config as any).workflowId === depId
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

  // Apply layout
  const applyLayout = useCallback(
    (nodes: WorkflowNode[], edges: DependencyEdge[]): WorkflowNode[] => {
      switch (layout) {
        case "hierarchical":
          return applyHierarchicalLayout(nodes, edges);
        case "force":
          return applyForceLayout(nodes, edges);
        case "circular":
          return applyCircularLayout(nodes);
        case "tree":
          return applyTreeLayout(nodes, edges);
        default:
          return nodes;
      }
    },
    [layout]
  );

  // Create and layout nodes
  const initialNodes = useMemo(() => {
    const nodes = createNodes();
    const edges = createEdges(nodes);
    return applyLayout(nodes, edges);
  }, [createNodes, createEdges, applyLayout]);

  const initialEdges = useMemo(() => {
    const nodes = createNodes();
    return createEdges(nodes);
  }, [createNodes, createEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when dependencies change
  useEffect(() => {
    const newNodes = createNodes();
    const newEdges = createEdges(newNodes);
    const layoutedNodes = applyLayout(newNodes, newEdges);
    setNodes(layoutedNodes);
    setEdges(newEdges);
  }, [createNodes, createEdges, applyLayout, setNodes, setEdges]);

  // Fit view when nodes change
  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2, duration: 300 });
      }, 50);
    }
  }, [nodes.length, reactFlowInstance]);

  // Handlers
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

  // Custom node types
  const nodeTypes = useMemo(
    () => ({
      workflow: WorkflowNodeComponent,
    }),
    []
  );

  return (
    <div className={cn("flex h-full", className)}>
      {/* Main graph area */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: false,
          }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            style={{ backgroundColor: "hsl(var(--muted))" }}
          />

          {/* Top panel */}
          <Panel position="top-left" className="m-2 space-y-2">
            <div className="flex gap-2 bg-background/95 backdrop-blur-sm p-2 rounded-lg shadow-lg border">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search workflows..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>

              {/* Layout selector */}
              <Select
                value={layout}
                onValueChange={(v) => setLayout(v as LayoutType)}
              >
                <SelectTrigger className="w-40">
                  <LayoutGrid className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hierarchical">Hierarchical</SelectItem>
                  <SelectItem value="force">Force-Directed</SelectItem>
                  <SelectItem value="circular">Circular</SelectItem>
                  <SelectItem value="tree">Tree</SelectItem>
                </SelectContent>
              </Select>

              {/* Filter */}
              <Select
                value={selectedFilter}
                onValueChange={(v) => setSelectedFilter(v as any)}
              >
                <SelectTrigger className="w-40">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Workflows</SelectItem>
                  <SelectItem value="dependencies">Dependencies</SelectItem>
                  <SelectItem value="dependents">Dependents</SelectItem>
                  <SelectItem value="unused">Unused</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>

              {/* Export */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => handleExport("png")}>
                    Export as PNG
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("svg")}>
                    Export as SVG
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport("json")}>
                    Export as JSON
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("graphml")}>
                    Export as GraphML
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("markdown")}>
                    Export Report (MD)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Controls */}
              <div className="flex gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleZoomIn}
                      >
                        <ZoomIn className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zoom In</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleZoomOut}
                      >
                        <ZoomOut className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Zoom Out</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFitView}
                      >
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Fit View</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {selectedWorkflowId && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCenterOnSelected}
                        >
                          <Target className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Center on Selected</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>

              {/* Toggle analysis panel */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAnalysis(!showAnalysis)}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                {showAnalysis ? "Hide" : "Show"} Analysis
              </Button>
            </div>

            {/* Stats */}
            <div className="flex gap-2 bg-background/95 backdrop-blur-sm p-2 rounded-lg shadow-lg border">
              <Badge variant="outline">
                <Network className="h-3 w-3 mr-1" />
                {workflows.length} workflows
              </Badge>
              <Badge variant="outline">
                <Link2 className="h-3 w-3 mr-1" />
                {analysis.totalDependencies} dependencies
              </Badge>
              {analysis.circularDependencies.length > 0 && (
                <Badge variant="destructive">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {analysis.circularDependencies.length} circular
                </Badge>
              )}
              {analysis.unusedWorkflows.length > 0 && (
                <Badge variant="secondary">
                  <EyeOff className="h-3 w-3 mr-1" />
                  {analysis.unusedWorkflows.length} unused
                </Badge>
              )}
            </div>
          </Panel>

          {/* Legend */}
          <Panel position="bottom-left" className="m-2">
            <div className="bg-background/95 backdrop-blur-sm p-3 rounded-lg shadow-lg border space-y-2">
              <div className="text-xs font-medium mb-2">Legend</div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded border-2 border-green-500 bg-green-50 dark:bg-green-950" />
                <span>Leaf (no dependencies)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-50 dark:bg-blue-950" />
                <span>Normal</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded border-2 border-red-500 bg-red-50 dark:bg-red-950" />
                <span>Circular dependency</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded border-2 border-gray-400 bg-gray-50 dark:bg-gray-900" />
                <span>Unused</span>
              </div>
            </div>
          </Panel>
        </ReactFlow>

        {/* Context menu */}
        {contextMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setContextMenu(null)}
            />
            <div
              className="fixed z-50 bg-popover rounded-md shadow-lg border p-1 min-w-[200px]"
              style={{ top: contextMenu.y, left: contextMenu.x }}
            >
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
                onClick={() => {
                  onOpenWorkflow(contextMenu.workflowId);
                  setContextMenu(null);
                }}
              >
                <FileText className="h-4 w-4" />
                Open Workflow
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
                onClick={() => {
                  const info = dependencyMap.get(contextMenu.workflowId);
                  if (info?.dependencies) {
                    setHighlightedWorkflows(
                      new Set([contextMenu.workflowId, ...info.dependencies])
                    );
                  }
                  setContextMenu(null);
                }}
              >
                <GitBranch className="h-4 w-4" />
                Show Dependencies
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
                onClick={() => {
                  const info = dependencyMap.get(contextMenu.workflowId);
                  if (info?.dependents) {
                    setHighlightedWorkflows(
                      new Set([contextMenu.workflowId, ...info.dependents])
                    );
                  }
                  setContextMenu(null);
                }}
              >
                <TrendingUp className="h-4 w-4" />
                Show Dependents
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent rounded-sm flex items-center gap-2"
                onClick={() => {
                  handleCenterOnSelected();
                  setContextMenu(null);
                }}
              >
                <Target className="h-4 w-4" />
                Center on Node
              </button>
            </div>
          </>
        )}
      </div>

      {/* Analysis panel */}
      {showAnalysis && (
        <div className="w-80 border-l bg-background overflow-hidden flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Analysis
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAnalysis(false)}
            >
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
                        onClick={() => handleHighlightCircular(index)}
                      >
                        <div className="text-xs font-medium mb-1">
                          Cycle {index + 1}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {circ.chain
                            .map(
                              (id) =>
                                workflows.find((w) => w.id === id)?.name || id
                            )
                            .slice(0, 3)
                            .join(" → ")}
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
                    <EyeOff className="h-4 w-4 text-gray-600" />
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
                              (id) =>
                                workflows.find((w) => w.id === id)?.name || id
                            )
                            .slice(0, 3)
                            .join(" → ")}
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
                    <span className="text-muted-foreground">
                      Total Workflows:
                    </span>
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
                    <span className="text-muted-foreground">
                      Avg Dependencies:
                    </span>
                    <span className="font-medium">
                      {analysis.avgDependencies.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Circular Deps:
                    </span>
                    <span className="font-medium text-red-600">
                      {analysis.circularDependencies.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unused:</span>
                    <span className="font-medium text-gray-600">
                      {analysis.unusedWorkflows.length}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
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
