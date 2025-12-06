/**
 * Auto-Layout Integration for Format Conversion
 *
 * Integrates auto-layout algorithms with format conversion process.
 * Provides layout application, style selection, and preview capabilities.
 */

import type { Workflow } from "../../lib/action-schema/action-types";
import {
  LayoutStyle,
  type LayoutConfig,
  autoLayoutWorkflow,
} from "../../lib/workflow-layout/auto-layout";

// ============================================================================
// Types
// ============================================================================

export interface LayoutApplication {
  /** Whether layout was applied successfully */
  success: boolean;

  /** Layout style that was applied */
  style: LayoutStyle;

  /** Time taken to apply layout (milliseconds) */
  duration: number;

  /** Number of actions positioned */
  actionsPositioned: number;

  /** Error message if layout failed */
  error?: string;
}

export interface LayoutPreview {
  /** Preview positions for actions */
  positions: Map<string, [number, number]>;

  /** Estimated bounds of layout */
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
  };

  /** Layout style */
  style: LayoutStyle;
}

export interface LayoutStyleInfo {
  /** Layout style ID */
  style: LayoutStyle;

  /** Display name */
  name: string;

  /** Description */
  description: string;

  /** Best use cases */
  bestFor: string[];

  /** Icon name (for UI) */
  icon: string;

  /** Is this style recommended for the given workflow */
  recommended: boolean;
}

// ============================================================================
// Auto-Layout Integration
// ============================================================================

/**
 * Apply auto-layout to a workflow after conversion
 */
export function applyAutoLayoutOnConversion(
  workflow: Workflow,
  style: LayoutStyle = LayoutStyle.HIERARCHICAL,
  config?: Partial<LayoutConfig>
): LayoutApplication {
  const startTime = Date.now();

  try {
    const layoutConfig: LayoutConfig = {
      ...config,
      style,
    };

    autoLayoutWorkflow(workflow, layoutConfig, style);

    const duration = Date.now() - startTime;

    return {
      success: true,
      style,
      duration,
      actionsPositioned: workflow.actions.length,
    };
  } catch (error: any) {
    return {
      success: false,
      style,
      duration: Date.now() - startTime,
      actionsPositioned: 0,
      error: error.message || "Failed to apply layout",
    };
  }
}

/**
 * Preview layout without modifying the workflow
 */
export function previewLayout(
  workflow: Workflow,
  style: LayoutStyle = LayoutStyle.HIERARCHICAL,
  config?: Partial<LayoutConfig>
): LayoutPreview {
  // Clone workflow to avoid modifying original
  const clonedWorkflow = cloneWorkflowForLayout(workflow);

  // Apply layout to clone
  autoLayoutWorkflow(clonedWorkflow, config, style);

  // Extract positions
  const positions = new Map<string, [number, number]>();
  clonedWorkflow.actions.forEach((action) => {
    positions.set(action.id, action.position);
  });

  // Calculate bounds
  const bounds = calculateLayoutBounds(clonedWorkflow);

  return {
    positions,
    bounds,
    style,
  };
}

/**
 * Get recommended layout style for a workflow
 */
export function getRecommendedLayoutStyle(workflow: Workflow): LayoutStyle {
  const actionCount = workflow.actions.length;
  const hasControlFlow = workflow.actions.some((a) =>
    ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(a.type)
  );

  // Small workflows work well with any layout
  if (actionCount <= 5) {
    return LayoutStyle.HIERARCHICAL;
  }

  // Complex control flow benefits from hierarchical layout
  if (hasControlFlow) {
    return LayoutStyle.HIERARCHICAL;
  }

  // Linear workflows work well with horizontal layout
  const connectionCount = Object.keys(workflow.connections || {}).length;
  if (connectionCount <= actionCount) {
    return LayoutStyle.HORIZONTAL;
  }

  // Default to hierarchical for complex workflows
  return LayoutStyle.HIERARCHICAL;
}

/**
 * Get information about all available layout styles
 */
export function getLayoutStyleInfo(workflow: Workflow): LayoutStyleInfo[] {
  const recommended = getRecommendedLayoutStyle(workflow);

  return [
    {
      style: LayoutStyle.HIERARCHICAL,
      name: "Hierarchical",
      description: "Top-to-bottom flow with layered nodes",
      bestFor: [
        "Control flow (IF, LOOP)",
        "Sequential workflows",
        "Clear execution order",
      ],
      icon: "layers",
      recommended: recommended === LayoutStyle.HIERARCHICAL,
    },
    {
      style: LayoutStyle.HORIZONTAL,
      name: "Horizontal",
      description: "Left-to-right flow, good for linear workflows",
      bestFor: [
        "Linear sequences",
        "Pipeline-style workflows",
        "Wide displays",
      ],
      icon: "arrow-right",
      recommended: recommended === LayoutStyle.HORIZONTAL,
    },
    {
      style: LayoutStyle.TREE,
      name: "Tree",
      description: "Tree structure with parent-child relationships",
      bestFor: [
        "Hierarchical data",
        "Branching workflows",
        "Clear parent-child",
      ],
      icon: "tree",
      recommended: recommended === LayoutStyle.TREE,
    },
    {
      style: LayoutStyle.FORCE_DIRECTED,
      name: "Force-Directed",
      description: "Physics-based layout, organic appearance",
      bestFor: ["Complex networks", "Many connections", "Exploring structure"],
      icon: "compass",
      recommended: recommended === LayoutStyle.FORCE_DIRECTED,
    },
    {
      style: LayoutStyle.CIRCULAR,
      name: "Circular",
      description: "Nodes arranged in a circle",
      bestFor: ["Cyclic workflows", "Equal relationships", "Compact display"],
      icon: "circle",
      recommended: recommended === LayoutStyle.CIRCULAR,
    },
  ];
}

/**
 * Get layout configuration recommendations for a workflow
 */
export function getRecommendedLayoutConfig(workflow: Workflow): LayoutConfig {
  const actionCount = workflow.actions.length;

  // Scale spacing based on workflow size
  let horizontalSpacing = 200;
  let verticalSpacing = 120;

  if (actionCount > 20) {
    horizontalSpacing = 150;
    verticalSpacing = 100;
  } else if (actionCount > 50) {
    horizontalSpacing = 120;
    verticalSpacing = 80;
  }

  return {
    horizontalSpacing,
    verticalSpacing,
    branchOffset: 150,
    centerPoint: [400, 300],
    maxOverlapIterations: 10,
    minNodeSpacing: 20,
  };
}

/**
 * Compare layout styles by applying them and measuring quality
 */
export interface LayoutComparison {
  style: LayoutStyle;
  quality: {
    /** Compactness score (0-100, higher is more compact) */
    compactness: number;
    /** Clarity score (0-100, higher is clearer) */
    clarity: number;
    /** Overall score (0-100) */
    overall: number;
  };
  bounds: {
    width: number;
    height: number;
  };
  duration: number;
}

export function compareLayoutStyles(
  workflow: Workflow,
  styles: LayoutStyle[] = [
    LayoutStyle.HIERARCHICAL,
    LayoutStyle.HORIZONTAL,
    LayoutStyle.TREE,
  ]
): LayoutComparison[] {
  const comparisons: LayoutComparison[] = [];

  for (const style of styles) {
    const startTime = Date.now();

    // Clone and layout
    const cloned = cloneWorkflowForLayout(workflow);
    autoLayoutWorkflow(cloned, undefined, style);

    const duration = Date.now() - startTime;
    const bounds = calculateLayoutBounds(cloned);

    // Calculate quality metrics
    const compactness = calculateCompactness(cloned, bounds);
    const clarity = calculateClarity(cloned);
    const overall = (compactness + clarity) / 2;

    comparisons.push({
      style,
      quality: { compactness, clarity, overall },
      bounds: { width: bounds.width, height: bounds.height },
      duration,
    });
  }

  // Sort by overall quality descending
  comparisons.sort((a, b) => b.quality.overall - a.quality.overall);

  return comparisons;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Clone a workflow for layout preview without modifying original
 */
function cloneWorkflowForLayout(workflow: Workflow): Workflow {
  return JSON.parse(JSON.stringify(workflow));
}

/**
 * Calculate layout bounds
 */
function calculateLayoutBounds(workflow: Workflow): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (workflow.actions.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  workflow.actions.forEach((action) => {
    const [x, y] = action.position;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  // Add node dimensions
  const nodeWidth = 180;
  const nodeHeight = 80;

  return {
    minX,
    maxX: maxX + nodeWidth,
    minY,
    maxY: maxY + nodeHeight,
    width: maxX - minX + nodeWidth,
    height: maxY - minY + nodeHeight,
  };
}

/**
 * Calculate compactness score (0-100, higher is better)
 */
function calculateCompactness(
  workflow: Workflow,
  bounds: { width: number; height: number }
): number {
  const actionCount = workflow.actions.length;
  if (actionCount === 0) return 100;

  // Ideal area would be nodes arranged in a square grid
  const nodeArea = 180 * 80; // Approximate node size
  const idealArea = nodeArea * actionCount * 1.5; // Allow 50% spacing

  const actualArea = bounds.width * bounds.height;

  // Score based on how close to ideal
  const ratio = idealArea / actualArea;
  const score = Math.min(100, ratio * 100);

  return score;
}

/**
 * Calculate clarity score (0-100, higher is better)
 * Based on overlap and edge crossing
 */
function calculateClarity(workflow: Workflow): number {
  let score = 100;

  // Check for overlapping nodes
  let overlaps = 0;
  for (let i = 0; i < workflow.actions.length; i++) {
    for (let j = i + 1; j < workflow.actions.length; j++) {
      if (hasOverlap(workflow.actions[i], workflow.actions[j])) {
        overlaps++;
      }
    }
  }

  // Penalize overlaps heavily
  score -= overlaps * 10;

  // Check spacing uniformity
  const spacings: number[] = [];
  workflow.actions.forEach((action) => {
    const [x1, y1] = action.position;

    workflow.actions.forEach((other) => {
      if (action.id === other.id) return;
      const [x2, y2] = other.position;
      const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      spacings.push(dist);
    });
  });

  if (spacings.length > 0) {
    const avgSpacing =
      spacings.reduce((sum, d) => sum + d, 0) / spacings.length;
    const variance =
      spacings.reduce((sum, d) => sum + (d - avgSpacing) ** 2, 0) /
      spacings.length;
    const stdDev = Math.sqrt(variance);

    // Penalize high variance in spacing
    const uniformity = Math.max(0, 100 - (stdDev / avgSpacing) * 50);
    score = (score + uniformity) / 2;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Check if two actions overlap
 */
function hasOverlap(action1: any, action2: any): boolean {
  const [x1, y1] = action1.position;
  const [x2, y2] = action2.position;

  const nodeWidth = 180;
  const nodeHeight = 80;
  const minSpacing = 20;

  const overlapX = Math.abs(x1 - x2) < nodeWidth + minSpacing;
  const overlapY = Math.abs(y1 - y2) < nodeHeight + minSpacing;

  return overlapX && overlapY;
}

/**
 * Get layout style display name
 */
export function getLayoutStyleName(style: LayoutStyle): string {
  const styleInfo = {
    [LayoutStyle.HIERARCHICAL]: "Hierarchical",
    [LayoutStyle.HORIZONTAL]: "Horizontal",
    [LayoutStyle.TREE]: "Tree",
    [LayoutStyle.FORCE_DIRECTED]: "Force-Directed",
    [LayoutStyle.CIRCULAR]: "Circular",
  };

  return styleInfo[style] || "Unknown";
}

/**
 * Get layout style icon
 */
export function getLayoutStyleIcon(style: LayoutStyle): string {
  const icons = {
    [LayoutStyle.HIERARCHICAL]: "layers",
    [LayoutStyle.HORIZONTAL]: "arrow-right",
    [LayoutStyle.TREE]: "tree",
    [LayoutStyle.FORCE_DIRECTED]: "compass",
    [LayoutStyle.CIRCULAR]: "circle",
  };

  return icons[style] || "layout";
}

/**
 * Apply auto-layout with best style detection
 */
export function applyBestLayout(workflow: Workflow): LayoutApplication {
  const recommended = getRecommendedLayoutStyle(workflow);
  const config = getRecommendedLayoutConfig(workflow);

  return applyAutoLayoutOnConversion(workflow, recommended, config);
}
