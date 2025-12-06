/**
 * Layout Service - Integration layer for auto-layout algorithms
 *
 * This service provides a high-level API for applying layout algorithms
 * to workflows with preview, statistics, and recommendation capabilities.
 *
 * Features:
 * - Apply layout with various styles and options
 * - Preview layouts before applying
 * - Detect layout issues (overlaps, unpositioned nodes)
 * - Recommend best layout for workflow structure
 * - Calculate layout quality metrics
 */

import {
  AutoLayout,
  LayoutStyle,
  LayoutConfig,
} from "@/lib/workflow-layout/auto-layout";
import type { Workflow } from "@/lib/action-schema/action-types";
import { calculateLayoutStatistics, compareLayouts } from "./layout-statistics";
import type { LayoutStatistics, LayoutComparison } from "./layout-statistics";

// ============================================================================
// Types
// ============================================================================

export interface LayoutOptions extends LayoutConfig {
  /** Animate the layout transition */
  animate?: boolean;

  /** Animation duration in milliseconds */
  animationDuration?: number;

  /** Preserve manually positioned nodes */
  preserveManualPositions?: boolean;

  /** IDs of nodes to preserve positions for */
  preservedNodeIds?: string[];
}

export interface LayoutPreviewResult {
  /** Workflow with applied layout */
  workflow: Workflow;

  /** Layout quality statistics */
  statistics: LayoutStatistics;

  /** Comparison with original layout */
  comparison: LayoutComparison;

  /** Detected changes */
  changes: LayoutChange[];
}

export interface LayoutChange {
  /** Action ID */
  actionId: string;

  /** Action type */
  actionType: string;

  /** Old position */
  oldPosition: [number, number];

  /** New position */
  newPosition: [number, number];

  /** Distance moved */
  distance: number;
}

export interface LayoutRecommendation {
  /** Recommended layout style */
  style: LayoutStyle;

  /** Confidence score (0-1) */
  confidence: number;

  /** Reason for recommendation */
  reason: string;

  /** Alternative styles */
  alternatives: Array<{
    style: LayoutStyle;
    confidence: number;
    reason: string;
  }>;
}

// ============================================================================
// Layout Service
// ============================================================================

export class LayoutService {
  private autoLayout: AutoLayout;
  private defaultOptions: LayoutOptions;

  constructor(defaultOptions?: LayoutOptions) {
    this.defaultOptions = {
      nodeWidth: 180,
      nodeHeight: 80,
      horizontalSpacing: 200,
      verticalSpacing: 120,
      branchOffset: 150,
      centerPoint: [400, 300],
      maxOverlapIterations: 10,
      minNodeSpacing: 20,
      animate: true,
      animationDuration: 500,
      preserveManualPositions: false,
      ...defaultOptions,
    };

    this.autoLayout = new AutoLayout(this.defaultOptions);
  }

  /**
   * Apply layout to workflow (mutates the workflow)
   */
  applyLayout(
    workflow: Workflow,
    style: LayoutStyle = LayoutStyle.HIERARCHICAL,
    options?: LayoutOptions
  ): void {
    const opts = { ...this.defaultOptions, ...options };

    // Update AutoLayout config
    this.autoLayout.updateConfig(opts);

    // Preserve positions if requested
    const preservedPositions = new Map<string, [number, number]>();
    if (opts.preserveManualPositions && opts.preservedNodeIds) {
      for (const nodeId of opts.preservedNodeIds) {
        const action = workflow.actions.find((a) => a.id === nodeId);
        if (action?.position) {
          preservedPositions.set(nodeId, [...action.position]);
        }
      }
    }

    // Apply layout
    this.autoLayout.layout(workflow, style);

    // Restore preserved positions
    if (preservedPositions.size > 0) {
      for (const [nodeId, position] of preservedPositions.entries()) {
        const action = workflow.actions.find((a) => a.id === nodeId);
        if (action) {
          action.position = position;
        }
      }
    }
  }

  /**
   * Preview layout without mutating the workflow
   */
  previewLayout(
    workflow: Workflow,
    style: LayoutStyle = LayoutStyle.HIERARCHICAL,
    options?: LayoutOptions
  ): LayoutPreviewResult {
    // Deep clone workflow
    const clonedWorkflow = this.cloneWorkflow(workflow);

    // Apply layout to clone
    this.applyLayout(clonedWorkflow, style, options);

    // Calculate statistics after layout
    const afterStats = calculateLayoutStatistics(clonedWorkflow);

    // Compare layouts
    const comparison = compareLayouts(workflow, clonedWorkflow);

    // Detect changes
    const changes = this.detectChanges(workflow, clonedWorkflow);

    return {
      workflow: clonedWorkflow,
      statistics: afterStats,
      comparison,
      changes,
    };
  }

  /**
   * Check if workflow needs layout
   */
  needsLayout(workflow: Workflow): boolean {
    return this.hasOverlaps(workflow) || this.hasUnpositioned(workflow);
  }

  /**
   * Check if workflow has overlapping nodes
   */
  hasOverlaps(workflow: Workflow): boolean {
    const config = this.autoLayout.getConfig();

    for (let i = 0; i < workflow.actions.length; i++) {
      for (let j = i + 1; j < workflow.actions.length; j++) {
        const a1 = workflow.actions[i];
        const a2 = workflow.actions[j];

        if (!a1 || !a2 || !a1.position || !a2.position) continue;

        const [x1, y1] = a1.position;
        const [x2, y2] = a2.position;

        const overlapX =
          Math.abs(x1 - x2) < config.nodeWidth + config.minNodeSpacing;
        const overlapY =
          Math.abs(y1 - y2) < config.nodeHeight + config.minNodeSpacing;

        if (overlapX && overlapY) return true;
      }
    }

    return false;
  }

  /**
   * Check if workflow has unpositioned nodes
   */
  hasUnpositioned(workflow: Workflow): boolean {
    return workflow.actions.some(
      (action) =>
        !action.position ||
        (action.position[0] === 0 && action.position[1] === 0)
    );
  }

  /**
   * Get recommended layout style for workflow
   */
  getRecommendedLayout(workflow: Workflow): LayoutRecommendation {
    const actionCount = workflow.actions.length;
    const branchingCount = this.countBranchingActions(workflow);
    const depth = this.calculateDepth(workflow);
    const width = this.calculateWidth(workflow);
    const cycleCount = this.detectCycles(workflow);

    // Scoring system for each layout style
    const scores = new Map<LayoutStyle, { score: number; reason: string }>();

    // Hierarchical - default, good for most workflows
    let hierarchicalScore = 0.7;
    let hierarchicalReason = "Good general-purpose layout";

    if (branchingCount > 0) {
      hierarchicalScore += 0.15;
      hierarchicalReason = "Optimal for workflows with branching logic";
    }

    if (depth > 5) {
      hierarchicalScore += 0.1;
      hierarchicalReason = "Best for deep hierarchical structures";
    }

    scores.set(LayoutStyle.HIERARCHICAL, {
      score: hierarchicalScore,
      reason: hierarchicalReason,
    });

    // Horizontal - good for linear flows
    let horizontalScore = 0.5;
    let horizontalReason = "Alternative left-to-right flow";

    if (branchingCount === 0 && depth <= 10) {
      horizontalScore = 0.8;
      horizontalReason = "Optimal for linear sequential flows";
    }

    scores.set(LayoutStyle.HORIZONTAL, {
      score: horizontalScore,
      reason: horizontalReason,
    });

    // Tree - good for hierarchical structures
    let treeScore = 0.6;
    let treeReason = "Compact tree structure";

    if (depth > 8 && width < 5) {
      treeScore = 0.85;
      treeReason = "Most compact for deeply nested workflows";
    }

    scores.set(LayoutStyle.TREE, { score: treeScore, reason: treeReason });

    // Force-directed - good for complex interconnected graphs
    let forceScore = 0.4;
    let forceReason = "Physics-based organic layout";

    if (cycleCount > 0 || actionCount > 20) {
      forceScore = 0.75;
      forceReason = "Best for complex interconnected workflows";
    }

    scores.set(LayoutStyle.FORCE_DIRECTED, {
      score: forceScore,
      reason: forceReason,
    });

    // Circular - good for small workflows and cycles
    let circularScore = 0.3;
    let circularReason = "Circular arrangement";

    if (actionCount <= 10 && cycleCount > 0) {
      circularScore = 0.7;
      circularReason = "Visually appealing for small workflows with cycles";
    }

    scores.set(LayoutStyle.CIRCULAR, {
      score: circularScore,
      reason: circularReason,
    });

    // Find best and alternatives
    const sorted = Array.from(scores.entries()).sort(
      (a, b) => b[1].score - a[1].score
    );

    const firstEntry = sorted[0];
    if (!firstEntry) {
      // Default to hierarchical if no scores
      return {
        style: LayoutStyle.HIERARCHICAL,
        confidence: 0.5,
        reason: "Default layout style",
        alternatives: [],
      };
    }

    const [bestStyle, bestInfo] = firstEntry;
    const alternatives = sorted.slice(1).map(([style, info]) => ({
      style,
      confidence: info.score,
      reason: info.reason,
    }));

    return {
      style: bestStyle,
      confidence: bestInfo.score,
      reason: bestInfo.reason,
      alternatives,
    };
  }

  /**
   * Update default options
   */
  updateDefaultOptions(options: Partial<LayoutOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
    this.autoLayout.updateConfig(this.defaultOptions);
  }

  /**
   * Get current default options
   */
  getDefaultOptions(): LayoutOptions {
    return { ...this.defaultOptions };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Deep clone a workflow
   */
  private cloneWorkflow(workflow: Workflow): Workflow {
    return JSON.parse(JSON.stringify(workflow));
  }

  /**
   * Detect changes between two workflows
   */
  private detectChanges(before: Workflow, after: Workflow): LayoutChange[] {
    const changes: LayoutChange[] = [];

    for (const action of before.actions) {
      const afterAction = after.actions.find((a) => a.id === action.id);
      if (!afterAction) continue;

      if (!action.position || !afterAction.position) continue;

      const [x1, y1] = action.position;
      const [x2, y2] = afterAction.position;

      // Calculate distance
      const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

      // Only include if position changed significantly
      if (distance > 1) {
        changes.push({
          actionId: action.id,
          actionType: action.type,
          oldPosition: [x1, y1],
          newPosition: [x2, y2],
          distance,
        });
      }
    }

    return changes.sort((a, b) => b.distance - a.distance);
  }

  /**
   * Count actions with branching outputs
   */
  private countBranchingActions(workflow: Workflow): number {
    return workflow.actions.filter(
      (action) =>
        action.type === "IF" ||
        action.type === "SWITCH" ||
        action.type === "TRY_CATCH"
    ).length;
  }

  /**
   * Calculate maximum depth of workflow
   */
  private calculateDepth(workflow: Workflow): number {
    const visited = new Set<string>();

    const dfs = (actionId: string): number => {
      if (visited.has(actionId)) return 0;
      visited.add(actionId);

      const connections = workflow.connections[actionId];
      if (!connections) return 1;

      let maxChildDepth = 0;

      for (const outputType of [
        "main",
        "error",
        "success",
      ] as const) {
        const outputs = connections[outputType];
        if (!outputs) continue;

        for (const conns of outputs) {
          for (const conn of conns) {
            const childDepth = dfs(conn.action);
            maxChildDepth = Math.max(maxChildDepth, childDepth);
          }
        }
      }

      return 1 + maxChildDepth;
    };

    // Find entry points
    const entryPoints = this.findEntryPoints(workflow);

    let maxDepth = 0;
    for (const entryId of entryPoints) {
      visited.clear();
      const depth = dfs(entryId);
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth;
  }

  /**
   * Calculate maximum width of workflow
   */
  private calculateWidth(workflow: Workflow): number {
    // Count maximum number of actions at any level
    const levels = new Map<number, number>();
    const visited = new Set<string>();

    const bfs = (startId: string) => {
      const queue: Array<{ id: string; level: number }> = [
        { id: startId, level: 0 },
      ];

      while (queue.length > 0) {
        const { id, level } = queue.shift()!;

        if (visited.has(id)) continue;
        visited.add(id);

        levels.set(level, (levels.get(level) || 0) + 1);

        const connections = workflow.connections[id];
        if (!connections) continue;

        for (const outputType of [
          "main",
          "error",
          "success",
        ] as const) {
          const outputs = connections[outputType];
          if (!outputs) continue;

          for (const conns of outputs) {
            for (const conn of conns) {
              queue.push({ id: conn.action, level: level + 1 });
            }
          }
        }
      }
    };

    const entryPoints = this.findEntryPoints(workflow);
    for (const entryId of entryPoints) {
      bfs(entryId);
    }

    return Math.max(...levels.values(), 1);
  }

  /**
   * Detect cycles in workflow (simple cycle detection)
   */
  private detectCycles(workflow: Workflow): number {
    let cycleCount = 0;
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (actionId: string): boolean => {
      visited.add(actionId);
      recStack.add(actionId);

      const connections = workflow.connections[actionId];
      if (connections) {
        for (const outputType of [
          "main",
          "error",
          "success",
        ] as const) {
          const outputs = connections[outputType];
          if (!outputs) continue;

          for (const conns of outputs) {
            for (const conn of conns) {
              if (!visited.has(conn.action)) {
                if (dfs(conn.action)) {
                  cycleCount++;
                  return true;
                }
              } else if (recStack.has(conn.action)) {
                cycleCount++;
                return true;
              }
            }
          }
        }
      }

      recStack.delete(actionId);
      return false;
    };

    for (const action of workflow.actions) {
      if (!visited.has(action.id)) {
        dfs(action.id);
      }
    }

    return cycleCount;
  }

  /**
   * Find entry points in workflow
   */
  private findEntryPoints(workflow: Workflow): string[] {
    if (!workflow.connections) {
      const firstAction = workflow.actions[0];
      return firstAction ? [firstAction.id] : [];
    }

    const hasIncoming = new Set<string>();

    for (const connections of Object.values(workflow.connections)) {
      for (const outputType of [
        "main",
        "error",
        "success",
      ] as const) {
        const outputs = connections[outputType];
        if (!outputs) continue;

        for (const conns of outputs) {
          for (const conn of conns) {
            hasIncoming.add(conn.action);
          }
        }
      }
    }

    return workflow.actions
      .filter((action) => !hasIncoming.has(action.id))
      .map((action) => action.id);
  }
}

/**
 * Create a singleton instance of LayoutService
 */
let layoutServiceInstance: LayoutService | null = null;

export function getLayoutService(options?: LayoutOptions): LayoutService {
  if (!layoutServiceInstance) {
    layoutServiceInstance = new LayoutService(options);
  }
  return layoutServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetLayoutService(): void {
  layoutServiceInstance = null;
}
