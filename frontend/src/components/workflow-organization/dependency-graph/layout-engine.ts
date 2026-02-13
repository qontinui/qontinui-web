/**
 * Graph Layout Algorithms and Dependency Analysis Utilities
 *
 * Pure functions (non-React) for computing graph layouts and analyzing
 * workflow dependency structures.
 */

import dagre from "dagre";
import { Workflow } from "../../../lib/action-schema/action-types";
import {
  WorkflowNode,
  DependencyEdge,
  DependencyInfo,
  CircularDependency,
  GraphAnalysis,
  LayoutType,
} from "./types";

// ============================================================================
// Dependency Analysis Utilities
// ============================================================================

/**
 * Extract RUN_WORKFLOW dependencies from a workflow
 */
export function getWorkflowDependencies(workflow: Workflow): string[] {
  const dependencies = new Set<string>();

  workflow.actions.forEach((action) => {
    if (action.type === "RUN_WORKFLOW") {
      const config = action.config as { workflowId?: string };
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
export function buildDependencyMap(
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
export function detectCircularDependencies(
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
export function findLongestChains(
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
export function analyzeGraph(
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

/**
 * Apply the selected layout algorithm to nodes
 */
export function applyLayout(
  layoutType: LayoutType,
  nodes: WorkflowNode[],
  edges: DependencyEdge[]
): WorkflowNode[] {
  switch (layoutType) {
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
}

// ============================================================================
// Export Utilities
// ============================================================================

/**
 * Export graph as PNG
 */
export async function exportAsPNG(
  _reactFlowInstance: unknown,
  _filename: string = "dependency-graph.png"
) {
  // Use html2canvas or similar - for now just alert
  alert("PNG export would be implemented with html2canvas or similar library");
}

/**
 * Export graph as SVG
 */
export function exportAsSVG(
  _nodes: WorkflowNode[],
  _edges: DependencyEdge[],
  _filename: string = "dependency-graph.svg"
) {
  alert("SVG export would generate an SVG representation of the graph");
}

/**
 * Export graph data as JSON
 */
export function exportAsJSON(
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
export function exportAsGraphML(
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
export function exportAsMarkdown(
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
