/**
 * Workflow Dependency Analyzer Service
 *
 * Comprehensive dependency analysis for tracking workflow relationships:
 * - Dependency detection and graph building
 * - Circular dependency detection
 * - Impact analysis
 * - Dependency metrics and statistics
 * - Visualization data export
 * - Validation and cache management
 */

import {
  Workflow,
  Action,
  isActionOfType,
} from "../lib/action-schema/action-types";
import { RunWorkflowActionConfig } from "../lib/action-schema/configs/state-actions";

// ============================================================================
// Types
// ============================================================================

/**
 * Graph node representing a workflow
 */
export interface DependencyNode {
  /** Workflow ID */
  id: string;
  /** Workflow name */
  name: string;
  /** Workflow category */
  category?: string;
  /** Direct dependencies (workflows this one calls) */
  dependencies: string[];
  /** Direct dependents (workflows that call this one) */
  dependents: string[];
  /** In-degree (how many workflows depend on this) */
  inDegree: number;
  /** Out-degree (how many workflows this depends on) */
  outDegree: number;
  /** Depth in dependency tree (0 = no dependencies) */
  depth: number;
  /** Is part of a circular dependency */
  isCircular: boolean;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Dependency graph edge
 */
export interface DependencyEdge {
  /** Source workflow ID */
  from: string;
  /** Target workflow ID */
  to: string;
  /** Action IDs that create this dependency */
  actionIds: string[];
  /** Is this edge part of a cycle */
  isCyclic: boolean;
}

/**
 * Complete dependency graph
 */
export interface DependencyGraph {
  /** All workflow nodes */
  nodes: Map<string, DependencyNode>;
  /** All dependency edges */
  edges: DependencyEdge[];
  /** Circular dependency chains */
  cycles: string[][];
  /** Root workflows (no dependencies) */
  roots: string[];
  /** Leaf workflows (no dependents) */
  leaves: string[];
  /** Timestamp when graph was built */
  timestamp: number;
}

/**
 * Dependency tree for a single workflow
 */
export interface DependencyTree {
  /** Workflow ID */
  workflowId: string;
  /** Direct dependencies */
  dependencies: DependencyTree[];
  /** Maximum depth in this branch */
  depth: number;
  /** Is circular (appears in its own dependency tree) */
  isCircular: boolean;
}

/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
  /** Workflow being analyzed */
  workflowId: string;
  /** Direct dependents */
  directDependents: string[];
  /** All dependents (recursive) */
  allDependents: string[];
  /** Critical paths through this workflow */
  criticalPaths: string[][];
  /** Estimated impact level */
  impactLevel: "low" | "medium" | "high" | "critical";
  /** Number of workflows affected */
  affectedCount: number;
}

/**
 * Dependency statistics
 */
export interface DependencyStats {
  /** Total number of workflows */
  totalWorkflows: number;
  /** Total number of dependencies */
  totalDependencies: number;
  /** Number of circular dependencies */
  circularDependencies: number;
  /** Number of unused workflows */
  unusedWorkflows: number;
  /** Number of root workflows (no dependencies) */
  rootWorkflows: number;
  /** Number of leaf workflows (no dependents) */
  leafWorkflows: number;
  /** Average dependencies per workflow */
  avgDependenciesPerWorkflow: number;
  /** Average dependents per workflow */
  avgDependentsPerWorkflow: number;
  /** Maximum dependency depth */
  maxDepth: number;
  /** Most depended-upon workflows */
  mostDepended: Array<{ id: string; name: string; count: number }>;
  /** Most dependent workflows */
  mostDependencies: Array<{ id: string; name: string; count: number }>;
}

/**
 * Validation result for dependencies
 */
export interface DependencyValidation {
  /** Is valid */
  valid: boolean;
  /** Validation errors */
  errors: DependencyError[];
  /** Validation warnings */
  warnings: string[];
}

/**
 * Dependency error
 */
export interface DependencyError {
  /** Error type */
  type:
    | "missing_workflow"
    | "circular_dependency"
    | "invalid_reference"
    | "orphaned_workflow";
  /** Workflow ID where error occurs */
  workflowId: string;
  /** Action ID where error occurs (if applicable) */
  actionId?: string;
  /** Referenced workflow ID (if applicable) */
  referencedId?: string;
  /** Error message */
  message: string;
  /** Severity level */
  severity: "error" | "warning";
}

/**
 * Graph data for visualization (React Flow format)
 */
export interface GraphVisualizationData {
  /** Nodes for visualization */
  nodes: VisualizationNode[];
  /** Edges for visualization */
  edges: VisualizationEdge[];
}

/**
 * Visualization node
 */
export interface VisualizationNode {
  id: string;
  type: string;
  data: {
    label: string;
    category?: string;
    inDegree: number;
    outDegree: number;
    isCircular: boolean;
    depth: number;
  };
  position: { x: number; y: number };
}

/**
 * Visualization edge
 */
export interface VisualizationEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  label?: string;
  data?: {
    actionCount: number;
    isCyclic: boolean;
  };
}

/**
 * Dependency report
 */
export interface DependencyReport {
  /** Report metadata */
  metadata: {
    generated: string;
    totalWorkflows: number;
    version: string;
  };
  /** Overall statistics */
  statistics: DependencyStats;
  /** All workflows with dependencies */
  workflows: Array<{
    id: string;
    name: string;
    dependencies: string[];
    dependents: string[];
    depth: number;
    isCircular: boolean;
  }>;
  /** Circular dependencies */
  circularDependencies: string[][];
  /** Missing workflows */
  missingWorkflows: string[];
  /** Unused workflows */
  unusedWorkflows: string[];
}

// ============================================================================
// Workflow Dependency Analyzer
// ============================================================================

export class WorkflowDependencyAnalyzer {
  private static instance: WorkflowDependencyAnalyzer;
  private cache: DependencyGraph | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): WorkflowDependencyAnalyzer {
    if (!WorkflowDependencyAnalyzer.instance) {
      WorkflowDependencyAnalyzer.instance = new WorkflowDependencyAnalyzer();
    }
    return WorkflowDependencyAnalyzer.instance;
  }

  // ==========================================================================
  // Dependency Detection
  // ==========================================================================

  /**
   * Analyze dependencies for a single workflow
   */
  analyzeDependencies(workflow: Workflow): string[] {
    const dependencies = new Set<string>();

    for (const action of workflow.actions) {
      if (isActionOfType(action, "RUN_WORKFLOW")) {
        const config = action.config as RunWorkflowActionConfig;
        if (config.workflowId) {
          dependencies.add(config.workflowId);
        }
      }
    }

    return Array.from(dependencies);
  }

  /**
   * Find all RUN_WORKFLOW actions in a workflow
   */
  findRunWorkflowActions(workflow: Workflow): Action<"RUN_WORKFLOW">[] {
    return workflow.actions.filter((action): action is Action<"RUN_WORKFLOW"> =>
      isActionOfType(action, "RUN_WORKFLOW")
    );
  }

  /**
   * Get direct dependencies for a workflow
   */
  getDependencies(workflowId: string, workflows: Workflow[]): string[] {
    const workflow = workflows.find((w) => w.id === workflowId);
    if (!workflow) {
      return [];
    }
    return this.analyzeDependencies(workflow);
  }

  /**
   * Get direct dependents (workflows that depend on this one)
   */
  getDependents(workflowId: string, workflows: Workflow[]): string[] {
    const dependents: string[] = [];

    for (const workflow of workflows) {
      const deps = this.analyzeDependencies(workflow);
      if (deps.includes(workflowId)) {
        dependents.push(workflow.id);
      }
    }

    return dependents;
  }

  /**
   * Get all dependencies recursively
   */
  getAllDependencies(
    workflowId: string,
    workflows: Workflow[],
    visited = new Set<string>()
  ): string[] {
    if (visited.has(workflowId)) {
      return []; // Prevent infinite recursion on circular deps
    }

    visited.add(workflowId);
    const allDeps = new Set<string>();
    const directDeps = this.getDependencies(workflowId, workflows);

    for (const dep of directDeps) {
      allDeps.add(dep);
      const subDeps = this.getAllDependencies(dep, workflows, visited);
      subDeps.forEach((d) => allDeps.add(d));
    }

    return Array.from(allDeps);
  }

  /**
   * Get all dependents recursively
   */
  getAllDependents(
    workflowId: string,
    workflows: Workflow[],
    visited = new Set<string>()
  ): string[] {
    if (visited.has(workflowId)) {
      return [];
    }

    visited.add(workflowId);
    const allDeps = new Set<string>();
    const directDeps = this.getDependents(workflowId, workflows);

    for (const dep of directDeps) {
      allDeps.add(dep);
      const subDeps = this.getAllDependents(dep, workflows, visited);
      subDeps.forEach((d) => allDeps.add(d));
    }

    return Array.from(allDeps);
  }

  // ==========================================================================
  // Graph Building
  // ==========================================================================

  /**
   * Build complete dependency graph
   */
  buildDependencyGraph(
    workflows: Workflow[],
    useCache = true
  ): DependencyGraph {
    // Check cache
    const now = Date.now();
    if (useCache && this.cache && now - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cache;
    }

    const nodes = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];

    // Initialize nodes
    for (const workflow of workflows) {
      nodes.set(workflow.id, {
        id: workflow.id,
        name: workflow.name,
        category: workflow.category,
        dependencies: [],
        dependents: [],
        inDegree: 0,
        outDegree: 0,
        depth: 0,
        isCircular: false,
        tags: workflow.tags,
      });
    }

    // Build edges and update dependencies/dependents
    for (const workflow of workflows) {
      const runWorkflowActions = this.findRunWorkflowActions(workflow);

      for (const action of runWorkflowActions) {
        const config = action.config as RunWorkflowActionConfig;
        const targetId = config.workflowId;

        if (!targetId) continue;

        const sourceNode = nodes.get(workflow.id);
        const targetNode = nodes.get(targetId);

        // Add to dependencies
        if (sourceNode && !sourceNode.dependencies.includes(targetId)) {
          sourceNode.dependencies.push(targetId);
          sourceNode.outDegree++;
        }

        // Add to dependents
        if (targetNode) {
          if (!targetNode.dependents.includes(workflow.id)) {
            targetNode.dependents.push(workflow.id);
            targetNode.inDegree++;
          }
        }

        // Create or update edge
        const existingEdge = edges.find(
          (e) => e.from === workflow.id && e.to === targetId
        );
        if (existingEdge) {
          existingEdge.actionIds.push(action.id);
        } else {
          edges.push({
            from: workflow.id,
            to: targetId,
            actionIds: [action.id],
            isCyclic: false,
          });
        }
      }
    }

    // Detect circular dependencies
    const cycles = this.findCircularDependencies(workflows);

    // Mark cyclic edges and nodes
    for (const cycle of cycles) {
      for (let i = 0; i < cycle.length; i++) {
        const from = cycle[i];
        const to = cycle[(i + 1) % cycle.length];

        // Mark edge as cyclic
        const edge = edges.find((e) => e.from === from && e.to === to);
        if (edge) {
          edge.isCyclic = true;
        }

        // Mark nodes as circular
        const node = nodes.get(from!);
        if (node) {
          node.isCircular = true;
        }
      }
    }

    // Calculate depths (topological sort with cycles handled)
    this.calculateDepths(nodes, edges, cycles);

    // Find roots and leaves
    const roots: string[] = [];
    const leaves: string[] = [];

    for (const [id, node] of nodes) {
      if (node.outDegree === 0) {
        roots.push(id);
      }
      if (node.inDegree === 0) {
        leaves.push(id);
      }
    }

    const graph: DependencyGraph = {
      nodes,
      edges,
      cycles,
      roots,
      leaves,
      timestamp: now,
    };

    // Update cache
    this.cache = graph;
    this.cacheTimestamp = now;

    return graph;
  }

  /**
   * Build dependency tree for a specific workflow
   */
  buildDependencyTree(
    workflowId: string,
    workflows: Workflow[],
    visited = new Set<string>(),
    currentDepth = 0
  ): DependencyTree {
    const isCircular = visited.has(workflowId);
    visited.add(workflowId);

    const dependencies = this.getDependencies(workflowId, workflows);
    const childTrees: DependencyTree[] = [];
    let maxDepth = currentDepth;

    if (!isCircular) {
      for (const depId of dependencies) {
        const childTree = this.buildDependencyTree(
          depId,
          workflows,
          new Set(visited),
          currentDepth + 1
        );
        childTrees.push(childTree);
        maxDepth = Math.max(maxDepth, childTree.depth);
      }
    }

    return {
      workflowId,
      dependencies: childTrees,
      depth: maxDepth,
      isCircular,
    };
  }

  // ==========================================================================
  // Analysis
  // ==========================================================================

  /**
   * Find circular dependencies using DFS
   */
  findCircularDependencies(workflows: Workflow[]): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const workflowMap = new Map(workflows.map((w) => [w.id, w]));

    const dfs = (workflowId: string, path: string[] = []): void => {
      if (recursionStack.has(workflowId)) {
        // Found a cycle - extract it from the path
        const cycleStart = path.indexOf(workflowId);
        if (cycleStart !== -1) {
          const cycle = [...path.slice(cycleStart), workflowId];
          // Check if this cycle is already recorded (in any rotation)
          const cycleKey = this.normalizeCycle(cycle);
          const existing = cycles.find(
            (c) => this.normalizeCycle(c) === cycleKey
          );
          if (!existing) {
            cycles.push(cycle);
          }
        }
        return;
      }

      if (visited.has(workflowId)) {
        return;
      }

      visited.add(workflowId);
      recursionStack.add(workflowId);
      path.push(workflowId);

      const workflow = workflowMap.get(workflowId);
      if (workflow) {
        const deps = this.analyzeDependencies(workflow);
        for (const dep of deps) {
          dfs(dep, [...path]);
        }
      }

      recursionStack.delete(workflowId);
    };

    for (const workflow of workflows) {
      if (!visited.has(workflow.id)) {
        dfs(workflow.id);
      }
    }

    return cycles;
  }

  /**
   * Find unused workflows (never called by any other workflow)
   */
  findUnusedWorkflows(workflows: Workflow[]): string[] {
    const used = new Set<string>();

    for (const workflow of workflows) {
      const deps = this.analyzeDependencies(workflow);
      deps.forEach((dep) => used.add(dep));
    }

    return workflows.filter((w) => !used.has(w.id)).map((w) => w.id);
  }

  /**
   * Get impact analysis for a workflow
   */
  getImpactAnalysis(workflowId: string, workflows: Workflow[]): ImpactAnalysis {
    const directDependents = this.getDependents(workflowId, workflows);
    const allDependents = this.getAllDependents(workflowId, workflows);
    const criticalPaths = this.findCriticalPaths(workflowId, workflows);

    const affectedCount = allDependents.length;
    let impactLevel: "low" | "medium" | "high" | "critical";

    if (affectedCount === 0) {
      impactLevel = "low";
    } else if (affectedCount <= 2) {
      impactLevel = "medium";
    } else if (affectedCount <= 5) {
      impactLevel = "high";
    } else {
      impactLevel = "critical";
    }

    return {
      workflowId,
      directDependents,
      allDependents,
      criticalPaths,
      impactLevel,
      affectedCount,
    };
  }

  /**
   * Get dependency depth for a workflow
   */
  getDependencyDepth(workflowId: string, workflows: Workflow[]): number {
    const tree = this.buildDependencyTree(workflowId, workflows);
    return tree.depth;
  }

  /**
   * Get overall dependency statistics
   */
  getDependencyStats(workflows: Workflow[]): DependencyStats {
    const graph = this.buildDependencyGraph(workflows);
    const totalWorkflows = workflows.length;
    const totalDependencies = graph.edges.length;
    const circularDependencies = graph.cycles.length;
    const unusedWorkflows = this.findUnusedWorkflows(workflows).length;

    let totalDeps = 0;
    let totalDependents = 0;
    let maxDepth = 0;

    for (const node of graph.nodes.values()) {
      totalDeps += node.outDegree;
      totalDependents += node.inDegree;
      maxDepth = Math.max(maxDepth, node.depth);
    }

    const avgDependenciesPerWorkflow =
      totalWorkflows > 0 ? totalDeps / totalWorkflows : 0;
    const avgDependentsPerWorkflow =
      totalWorkflows > 0 ? totalDependents / totalWorkflows : 0;

    // Most depended-upon workflows
    const mostDepended = Array.from(graph.nodes.values())
      .filter((n) => n.inDegree > 0)
      .sort((a, b) => b.inDegree - a.inDegree)
      .slice(0, 10)
      .map((n) => ({ id: n.id, name: n.name, count: n.inDegree }));

    // Most dependent workflows
    const mostDependencies = Array.from(graph.nodes.values())
      .filter((n) => n.outDegree > 0)
      .sort((a, b) => b.outDegree - a.outDegree)
      .slice(0, 10)
      .map((n) => ({ id: n.id, name: n.name, count: n.outDegree }));

    return {
      totalWorkflows,
      totalDependencies,
      circularDependencies,
      unusedWorkflows,
      rootWorkflows: graph.roots.length,
      leafWorkflows: graph.leaves.length,
      avgDependenciesPerWorkflow,
      avgDependentsPerWorkflow,
      maxDepth,
      mostDepended,
      mostDependencies,
    };
  }

  // ==========================================================================
  // Visualization Data
  // ==========================================================================

  /**
   * Get graph data for visualization (React Flow format)
   */
  getGraphData(workflows: Workflow[]): GraphVisualizationData {
    return this.getNodesAndEdges(workflows);
  }

  /**
   * Get nodes and edges for graph visualization
   */
  getNodesAndEdges(workflows: Workflow[]): GraphVisualizationData {
    const graph = this.buildDependencyGraph(workflows);
    const nodes: VisualizationNode[] = [];
    const edges: VisualizationEdge[] = [];

    // Create nodes with automatic layout
    const layoutConfig = this.calculateLayout(graph);

    for (const [id, node] of graph.nodes) {
      const position = layoutConfig.get(id) || { x: 0, y: 0 };

      nodes.push({
        id,
        type: node.isCircular
          ? "circular"
          : node.inDegree === 0
            ? "leaf"
            : "default",
        data: {
          label: node.name || id,
          category: node.category,
          inDegree: node.inDegree,
          outDegree: node.outDegree,
          isCircular: node.isCircular,
          depth: node.depth,
        },
        position,
      });
    }

    // Create edges
    for (const edge of graph.edges) {
      edges.push({
        id: `${edge.from}-${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: edge.isCyclic ? "cyclic" : "default",
        animated: edge.isCyclic,
        label:
          edge.actionIds.length > 1 ? `${edge.actionIds.length}x` : undefined,
        data: {
          actionCount: edge.actionIds.length,
          isCyclic: edge.isCyclic,
        },
      });
    }

    return { nodes, edges };
  }

  /**
   * Get critical paths (longest dependency chains)
   */
  getCriticalPath(workflows: Workflow[]): string[][] {
    const graph = this.buildDependencyGraph(workflows);
    const paths: string[][] = [];

    // Find all root nodes
    for (const rootId of graph.roots) {
      const pathsFromRoot = this.findAllPaths(rootId, graph, new Set());
      paths.push(...pathsFromRoot);
    }

    // Sort by length (longest first)
    paths.sort((a, b) => b.length - a.length);

    // Return top 10 longest paths
    return paths.slice(0, 10);
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate dependencies for a workflow
   */
  validateDependencies(
    workflow: Workflow,
    workflows: Workflow[]
  ): DependencyValidation {
    const errors: DependencyError[] = [];
    const warnings: string[] = [];

    const workflowIds = new Set(workflows.map((w) => w.id));
    const runWorkflowActions = this.findRunWorkflowActions(workflow);

    for (const action of runWorkflowActions) {
      const config = action.config as RunWorkflowActionConfig;
      const targetId = config.workflowId;

      if (!targetId) {
        errors.push({
          type: "invalid_reference",
          workflowId: workflow.id,
          actionId: action.id,
          message: "RUN_WORKFLOW action has no workflowId specified",
          severity: "error",
        });
        continue;
      }

      if (!workflowIds.has(targetId)) {
        errors.push({
          type: "missing_workflow",
          workflowId: workflow.id,
          actionId: action.id,
          referencedId: targetId,
          message: `Referenced workflow "${targetId}" does not exist`,
          severity: "error",
        });
      }

      // Check for self-reference
      if (targetId === workflow.id) {
        errors.push({
          type: "circular_dependency",
          workflowId: workflow.id,
          actionId: action.id,
          referencedId: targetId,
          message: "Workflow references itself",
          severity: "error",
        });
      }
    }

    // Check if workflow is part of a circular dependency
    const cycles = this.findCircularDependencies(workflows);
    for (const cycle of cycles) {
      if (cycle.includes(workflow.id)) {
        warnings.push(
          `Workflow is part of circular dependency: ${cycle.join(" -> ")}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Find missing workflows (referenced but don't exist)
   */
  findMissingWorkflows(workflow: Workflow, workflows: Workflow[]): string[] {
    const missing: string[] = [];
    const workflowIds = new Set(workflows.map((w) => w.id));
    const runWorkflowActions = this.findRunWorkflowActions(workflow);

    for (const action of runWorkflowActions) {
      const config = action.config as RunWorkflowActionConfig;
      const targetId = config.workflowId;

      if (
        targetId &&
        !workflowIds.has(targetId) &&
        !missing.includes(targetId)
      ) {
        missing.push(targetId);
      }
    }

    return missing;
  }

  /**
   * Validate circular references
   */
  validateCircularRefs(workflows: Workflow[]): DependencyError[] {
    const errors: DependencyError[] = [];
    const cycles = this.findCircularDependencies(workflows);

    for (const cycle of cycles) {
      const cycleStr = cycle.join(" -> ");
      for (const workflowId of cycle) {
        errors.push({
          type: "circular_dependency",
          workflowId,
          message: `Workflow is part of circular dependency: ${cycleStr}`,
          severity: "error",
        });
      }
    }

    return errors;
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate cache
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(): boolean {
    return (
      this.cache !== null && Date.now() - this.cacheTimestamp < this.CACHE_TTL
    );
  }

  /**
   * Get cached graph (if valid)
   */
  getCachedGraph(): DependencyGraph | null {
    return this.isCacheValid() ? this.cache : null;
  }

  // ==========================================================================
  // Export
  // ==========================================================================

  /**
   * Export dependency report
   */
  exportDependencyReport(workflows: Workflow[]): DependencyReport {
    const stats = this.getDependencyStats(workflows);
    const graph = this.buildDependencyGraph(workflows);
    const missing = new Set<string>();

    const workflowsData = workflows.map((w) => {
      const node = graph.nodes.get(w.id);
      const missingDeps = this.findMissingWorkflows(w, workflows);
      missingDeps.forEach((m) => missing.add(m));

      return {
        id: w.id,
        name: w.name,
        dependencies: node?.dependencies || [],
        dependents: node?.dependents || [],
        depth: node?.depth || 0,
        isCircular: node?.isCircular || false,
      };
    });

    return {
      metadata: {
        generated: new Date().toISOString(),
        totalWorkflows: workflows.length,
        version: "1.0.0",
      },
      statistics: stats,
      workflows: workflowsData,
      circularDependencies: graph.cycles,
      missingWorkflows: Array.from(missing),
      unusedWorkflows: this.findUnusedWorkflows(workflows),
    };
  }

  /**
   * Export to GraphML format
   */
  exportGraphML(workflows: Workflow[]): string {
    const graph = this.buildDependencyGraph(workflows);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">\n';
    xml +=
      '  <key id="name" for="node" attr.name="name" attr.type="string"/>\n';
    xml +=
      '  <key id="category" for="node" attr.name="category" attr.type="string"/>\n';
    xml += '  <key id="depth" for="node" attr.name="depth" attr.type="int"/>\n';
    xml +=
      '  <key id="circular" for="node" attr.name="circular" attr.type="boolean"/>\n';
    xml +=
      '  <key id="actions" for="edge" attr.name="actions" attr.type="int"/>\n';
    xml += '  <graph id="WorkflowDependencies" edgedefault="directed">\n';

    // Nodes
    for (const [id, node] of graph.nodes) {
      xml += `    <node id="${this.escapeXml(id)}">\n`;
      xml += `      <data key="name">${this.escapeXml(node.name)}</data>\n`;
      if (node.category) {
        xml += `      <data key="category">${this.escapeXml(node.category)}</data>\n`;
      }
      xml += `      <data key="depth">${node.depth}</data>\n`;
      xml += `      <data key="circular">${node.isCircular}</data>\n`;
      xml += "    </node>\n";
    }

    // Edges
    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];
      if (!edge) continue;
      xml += `    <edge id="e${i}" source="${this.escapeXml(edge.from)}" target="${this.escapeXml(edge.to)}">\n`;
      xml += `      <data key="actions">${edge.actionIds.length}</data>\n`;
      xml += "    </edge>\n";
    }

    xml += "  </graph>\n";
    xml += "</graphml>";

    return xml;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Calculate layout positions for nodes
   */
  private calculateLayout(
    graph: DependencyGraph
  ): Map<string, { x: number; y: number }> {
    const layout = new Map<string, { x: number; y: number }>();
    const layers = this.groupByDepth(graph);

    const layerSpacing = 300;
    const nodeSpacing = 150;

    let y = 50;
    for (const layer of layers) {
      const width = (layer.length - 1) * nodeSpacing;
      let x = -width / 2;

      for (const nodeId of layer) {
        layout.set(nodeId, { x, y });
        x += nodeSpacing;
      }

      y += layerSpacing;
    }

    return layout;
  }

  /**
   * Group nodes by depth
   */
  private groupByDepth(graph: DependencyGraph): string[][] {
    const layers: string[][] = [];
    const maxDepth = Math.max(
      ...Array.from(graph.nodes.values()).map((n) => n.depth)
    );

    for (let depth = 0; depth <= maxDepth; depth++) {
      const layer: string[] = [];
      for (const [id, node] of graph.nodes) {
        if (node.depth === depth) {
          layer.push(id);
        }
      }
      if (layer.length > 0) {
        layers.push(layer);
      }
    }

    return layers;
  }

  /**
   * Calculate depths for all nodes
   */
  private calculateDepths(
    nodes: Map<string, DependencyNode>,
    edges: DependencyEdge[],
    cycles: string[][]
  ): void {
    // Nodes in cycles get marked but we still calculate depth
    const inCycle = new Set<string>();
    for (const cycle of cycles) {
      cycle.forEach((id) => inCycle.add(id));
    }

    // Topological sort with cycle handling
    const visited = new Set<string>();
    const depths = new Map<string, number>();

    const dfs = (nodeId: string, currentDepth: number): number => {
      if (visited.has(nodeId)) {
        return depths.get(nodeId) || 0;
      }

      visited.add(nodeId);
      let maxDepth = currentDepth;

      const outgoingEdges = edges.filter((e) => e.from === nodeId);
      for (const edge of outgoingEdges) {
        if (!inCycle.has(edge.to) || !inCycle.has(nodeId)) {
          const childDepth = dfs(edge.to, currentDepth + 1);
          maxDepth = Math.max(maxDepth, childDepth);
        }
      }

      depths.set(nodeId, maxDepth);
      return maxDepth;
    };

    // Start from root nodes
    for (const [id, node] of nodes) {
      if (node.outDegree === 0) {
        dfs(id, 0);
      }
    }

    // Visit remaining nodes
    for (const [id] of nodes) {
      if (!visited.has(id)) {
        dfs(id, 0);
      }
    }

    // Update node depths
    for (const [id, depth] of depths) {
      const node = nodes.get(id);
      if (node) {
        node.depth = depth;
      }
    }
  }

  /**
   * Find all paths from a node
   */
  private findAllPaths(
    nodeId: string,
    graph: DependencyGraph,
    visited: Set<string>,
    currentPath: string[] = []
  ): string[][] {
    if (visited.has(nodeId)) {
      return []; // Avoid cycles
    }

    visited.add(nodeId);
    currentPath.push(nodeId);

    const node = graph.nodes.get(nodeId);
    if (!node || node.dependencies.length === 0) {
      // Leaf node - return current path
      return [[...currentPath]];
    }

    const allPaths: string[][] = [];
    for (const depId of node.dependencies) {
      const subPaths = this.findAllPaths(depId, graph, new Set(visited), [
        ...currentPath,
      ]);
      allPaths.push(...subPaths);
    }

    return allPaths;
  }

  /**
   * Find critical paths through a workflow
   */
  private findCriticalPaths(
    workflowId: string,
    workflows: Workflow[]
  ): string[][] {
    const graph = this.buildDependencyGraph(workflows);
    const paths: string[][] = [];

    // Find all paths that include this workflow
    const findPathsThrough = (
      currentId: string,
      visited: Set<string>,
      path: string[]
    ): void => {
      if (visited.has(currentId)) return;

      visited.add(currentId);
      path.push(currentId);

      if (currentId === workflowId || path.includes(workflowId)) {
        const node = graph.nodes.get(currentId);
        if (node && node.inDegree === 0) {
          // Reached a leaf - save this path
          paths.push([...path]);
        } else if (node) {
          // Continue exploring
          for (const dependent of node.dependents) {
            findPathsThrough(dependent, new Set(visited), [...path]);
          }
        }
      } else {
        const node = graph.nodes.get(currentId);
        if (node) {
          for (const dependency of node.dependencies) {
            findPathsThrough(dependency, new Set(visited), [...path]);
          }
        }
      }
    };

    // Start from root nodes
    for (const rootId of graph.roots) {
      findPathsThrough(rootId, new Set(), []);
    }

    return paths.slice(0, 10); // Return top 10
  }

  /**
   * Normalize cycle for comparison (rotate to start with smallest ID)
   */
  private normalizeCycle(cycle: string[]): string {
    if (cycle.length === 0) return "";

    const minIndex = cycle.indexOf(
      String(Math.min(...cycle.map((id) => Number(id))))
    );
    const rotated = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
    return rotated.join("->");
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workflowDependencyAnalyzer =
  WorkflowDependencyAnalyzer.getInstance();
