/**
 * Layout Statistics - Metrics and quality assessment for workflow layouts
 *
 * This module provides comprehensive metrics for evaluating layout quality:
 * - Node distribution and density
 * - Edge crossings and length
 * - Spatial utilization
 * - Overall layout quality scores
 */

import type {
  Workflow,
  Action,
} from "@/lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface LayoutStatistics {
  // Node metrics
  nodeCount: number;
  averageNodeDensity: number;
  nodesOverlapping: number;
  nodesWithoutPosition: number;

  // Edge metrics
  edgeCount: number;
  edgeCrossings: number;
  averageEdgeLength: number;
  minEdgeLength: number;
  maxEdgeLength: number;

  // Spatial metrics
  canvasWidth: number;
  canvasHeight: number;
  canvasArea: number;
  canvasUtilization: number; // 0-1
  boundingBoxAspectRatio: number;

  // Quality metrics
  layoutScore: number; // 0-100
  compactness: number; // 0-1 (higher is more compact)
  symmetry: number; // 0-1 (higher is more symmetric)
  alignment: number; // 0-1 (higher is better aligned)
  readability: number; // 0-1 (higher is more readable)
}

export interface LayoutComparison {
  // Overall comparison
  improvementScore: number; // -100 to +100 (positive is better)
  isImprovement: boolean;
  summary: string;

  // Metric comparisons
  metrics: {
    overlaps: { before: number; after: number; change: number };
    edgeCrossings: { before: number; after: number; change: number };
    edgeLength: { before: number; after: number; change: number };
    compactness: { before: number; after: number; change: number };
    readability: { before: number; after: number; change: number };
  };

  // Recommendations
  recommendations: string[];
}

interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface EdgeInfo {
  source: Action;
  target: Action;
  length: number;
  angle: number;
}

// ============================================================================
// Statistics Calculation
// ============================================================================

/**
 * Calculate comprehensive layout statistics
 */
export function calculateLayoutStatistics(
  workflow: Workflow,
  nodeWidth: number = 180,
  nodeHeight: number = 80
): LayoutStatistics {
  const actions = workflow.actions;

  if (actions.length === 0) {
    return createEmptyStatistics();
  }

  // Calculate bounding box
  const bbox = calculateBoundingBox(actions, nodeWidth, nodeHeight);

  // Calculate node metrics
  const nodeMetrics = calculateNodeMetrics(
    actions,
    nodeWidth,
    nodeHeight,
    bbox
  );

  // Calculate edge metrics
  const edgeMetrics = calculateEdgeMetrics(workflow, actions);

  // Calculate spatial metrics
  const spatialMetrics = calculateSpatialMetrics(
    actions,
    bbox,
    nodeWidth,
    nodeHeight
  );

  // Calculate quality metrics
  const qualityMetrics = calculateQualityMetrics(
    nodeMetrics,
    edgeMetrics,
    spatialMetrics
  );

  return {
    // Node metrics
    nodeCount: actions.length,
    averageNodeDensity: nodeMetrics.density,
    nodesOverlapping: nodeMetrics.overlapping,
    nodesWithoutPosition: nodeMetrics.withoutPosition,

    // Edge metrics
    edgeCount: edgeMetrics.count,
    edgeCrossings: edgeMetrics.crossings,
    averageEdgeLength: edgeMetrics.avgLength,
    minEdgeLength: edgeMetrics.minLength,
    maxEdgeLength: edgeMetrics.maxLength,

    // Spatial metrics
    canvasWidth: bbox.width,
    canvasHeight: bbox.height,
    canvasArea: bbox.width * bbox.height,
    canvasUtilization: spatialMetrics.utilization,
    boundingBoxAspectRatio: bbox.width / bbox.height,

    // Quality metrics
    layoutScore: qualityMetrics.score,
    compactness: qualityMetrics.compactness,
    symmetry: qualityMetrics.symmetry,
    alignment: qualityMetrics.alignment,
    readability: qualityMetrics.readability,
  };
}

/**
 * Compare two layouts and provide detailed analysis
 */
export function compareLayouts(
  before: Workflow,
  after: Workflow
): LayoutComparison {
  const beforeStats = calculateLayoutStatistics(before);
  const afterStats = calculateLayoutStatistics(after);

  // Calculate metric changes
  const overlapChange =
    beforeStats.nodesOverlapping - afterStats.nodesOverlapping;
  const crossingChange = beforeStats.edgeCrossings - afterStats.edgeCrossings;
  const lengthChange =
    beforeStats.averageEdgeLength - afterStats.averageEdgeLength;
  const compactnessChange = afterStats.compactness - beforeStats.compactness;
  const readabilityChange = afterStats.readability - beforeStats.readability;

  // Calculate overall improvement score (-100 to +100)
  let improvementScore = 0;

  // Overlaps (weight: 30)
  if (beforeStats.nodesOverlapping > 0) {
    improvementScore += (overlapChange / beforeStats.nodesOverlapping) * 30;
  }

  // Edge crossings (weight: 25)
  if (beforeStats.edgeCrossings > 0) {
    improvementScore += (crossingChange / beforeStats.edgeCrossings) * 25;
  }

  // Compactness (weight: 15)
  improvementScore += compactnessChange * 15;

  // Readability (weight: 20)
  improvementScore += readabilityChange * 20;

  // Edge length (weight: 10) - shorter is better
  if (beforeStats.averageEdgeLength > 0) {
    improvementScore += (lengthChange / beforeStats.averageEdgeLength) * 10;
  }

  // Clamp to -100 to +100
  improvementScore = Math.max(-100, Math.min(100, improvementScore));

  // Generate summary
  const summary = generateComparisonSummary(improvementScore);

  // Generate recommendations
  const recommendations = generateRecommendations(afterStats);

  return {
    improvementScore,
    isImprovement: improvementScore > 0,
    summary,
    metrics: {
      overlaps: {
        before: beforeStats.nodesOverlapping,
        after: afterStats.nodesOverlapping,
        change: overlapChange,
      },
      edgeCrossings: {
        before: beforeStats.edgeCrossings,
        after: afterStats.edgeCrossings,
        change: crossingChange,
      },
      edgeLength: {
        before: beforeStats.averageEdgeLength,
        after: afterStats.averageEdgeLength,
        change: lengthChange,
      },
      compactness: {
        before: beforeStats.compactness,
        after: afterStats.compactness,
        change: compactnessChange,
      },
      readability: {
        before: beforeStats.readability,
        after: afterStats.readability,
        change: readabilityChange,
      },
    },
    recommendations,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function createEmptyStatistics(): LayoutStatistics {
  return {
    nodeCount: 0,
    averageNodeDensity: 0,
    nodesOverlapping: 0,
    nodesWithoutPosition: 0,
    edgeCount: 0,
    edgeCrossings: 0,
    averageEdgeLength: 0,
    minEdgeLength: 0,
    maxEdgeLength: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    canvasArea: 0,
    canvasUtilization: 0,
    boundingBoxAspectRatio: 1,
    layoutScore: 0,
    compactness: 0,
    symmetry: 0,
    alignment: 0,
    readability: 0,
  };
}

function calculateBoundingBox(
  actions: Action[],
  nodeWidth: number,
  nodeHeight: number
): BoundingBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const action of actions) {
    if (!action.position) continue;

    const [x, y] = action.position;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + nodeWidth);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + nodeHeight);
  }

  if (minX === Infinity) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      width: 0,
      height: 0,
      centerX: 0,
      centerY: 0,
    };
  }

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function calculateNodeMetrics(
  actions: Action[],
  nodeWidth: number,
  nodeHeight: number,
  bbox: BoundingBox
) {
  let overlapping = 0;
  let withoutPosition = 0;

  // Check for overlaps
  for (let i = 0; i < actions.length; i++) {
    const a1 = actions[i];
    if (!a1.position) {
      withoutPosition++;
      continue;
    }

    for (let j = i + 1; j < actions.length; j++) {
      const a2 = actions[j];
      if (!a2.position) continue;

      const [x1, y1] = a1.position;
      const [x2, y2] = a2.position;

      const overlapX = Math.abs(x1 - x2) < nodeWidth;
      const overlapY = Math.abs(y1 - y2) < nodeHeight;

      if (overlapX && overlapY) {
        overlapping++;
      }
    }
  }

  // Calculate density (nodes per square unit)
  const totalArea = bbox.width * bbox.height;
  const density = totalArea > 0 ? actions.length / totalArea : 0;

  return {
    overlapping,
    withoutPosition,
    density,
  };
}

function calculateEdgeMetrics(workflow: Workflow, actions: Action[]) {
  const edges: EdgeInfo[] = [];

  // Build edge list
  for (const [sourceId, connections] of Object.entries(workflow.connections)) {
    const source = actions.find((a) => a.id === sourceId);
    if (!source?.position) continue;

    for (const outputType of [
      "main",
      "error",
      "success",
      "parallel",
    ] as const) {
      const outputs = connections[outputType];
      if (!outputs) continue;

      for (const conns of outputs) {
        for (const conn of conns) {
          const target = actions.find((a) => a.id === conn.action);
          if (!target?.position) continue;

          const [x1, y1] = source.position;
          const [x2, y2] = target.position;

          const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
          const angle = Math.atan2(y2 - y1, x2 - x1);

          edges.push({ source, target, length, angle });
        }
      }
    }
  }

  // Calculate edge crossings
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edgesIntersect(edges[i], edges[j])) {
        crossings++;
      }
    }
  }

  // Calculate length statistics
  const lengths = edges.map((e) => e.length);
  const avgLength =
    lengths.length > 0
      ? lengths.reduce((a, b) => a + b, 0) / lengths.length
      : 0;
  const minLength = lengths.length > 0 ? Math.min(...lengths) : 0;
  const maxLength = lengths.length > 0 ? Math.max(...lengths) : 0;

  return {
    count: edges.length,
    crossings,
    avgLength,
    minLength,
    maxLength,
  };
}

function edgesIntersect(e1: EdgeInfo, e2: EdgeInfo): boolean {
  const [x1, y1] = e1.source.position!;
  const [x2, y2] = e1.target.position!;
  const [x3, y3] = e2.source.position!;
  const [x4, y4] = e2.target.position!;

  // Skip if edges share a node
  if (
    e1.source.id === e2.source.id ||
    e1.source.id === e2.target.id ||
    e1.target.id === e2.source.id ||
    e1.target.id === e2.target.id
  ) {
    return false;
  }

  // Line intersection formula
  const det = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(det) < 1e-10) return false; // Parallel lines

  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / det;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / det;

  return t > 0 && t < 1 && u > 0 && u < 1;
}

function calculateSpatialMetrics(
  actions: Action[],
  bbox: BoundingBox,
  nodeWidth: number,
  nodeHeight: number
) {
  const totalNodeArea = actions.length * nodeWidth * nodeHeight;
  const totalArea = bbox.width * bbox.height;

  const utilization = totalArea > 0 ? totalNodeArea / totalArea : 0;

  return {
    utilization,
  };
}

function calculateQualityMetrics(
  nodeMetrics: any,
  edgeMetrics: any,
  spatialMetrics: any
) {
  // Compactness: prefer smaller bounding box (normalized)
  const compactness = Math.max(0, Math.min(1, spatialMetrics.utilization));

  // Symmetry: measure balance around center
  const symmetry = 0.7; // Placeholder - would need more complex calculation

  // Alignment: measure how well nodes align (placeholder)
  const alignment = 0.8; // Placeholder

  // Readability: inversely related to edge crossings and overlaps
  let readability = 1.0;
  if (nodeMetrics.overlapping > 0) {
    readability -= Math.min(0.5, nodeMetrics.overlapping * 0.1);
  }
  if (edgeMetrics.crossings > 0) {
    readability -= Math.min(0.3, edgeMetrics.crossings * 0.05);
  }
  readability = Math.max(0, readability);

  // Overall score (0-100)
  const score =
    compactness * 25 + symmetry * 20 + alignment * 20 + readability * 35;

  return {
    score,
    compactness,
    symmetry,
    alignment,
    readability,
  };
}

function generateComparisonSummary(
  improvementScore: number
): string {
  if (improvementScore > 50) {
    return "Significant improvement - layout is much better";
  } else if (improvementScore > 20) {
    return "Good improvement - layout quality increased";
  } else if (improvementScore > 5) {
    return "Minor improvement - slight layout enhancement";
  } else if (improvementScore > -5) {
    return "No significant change - layout quality similar";
  } else if (improvementScore > -20) {
    return "Minor degradation - layout slightly worse";
  } else {
    return "Significant degradation - previous layout was better";
  }
}

function generateRecommendations(
  stats: LayoutStatistics
): string[] {
  const recommendations: string[] = [];

  if (stats.nodesOverlapping > 0) {
    recommendations.push(
      `${stats.nodesOverlapping} nodes are still overlapping - try a different layout style`
    );
  }

  if (stats.edgeCrossings > 10) {
    recommendations.push(
      `High number of edge crossings (${stats.edgeCrossings}) - consider hierarchical layout`
    );
  }

  if (stats.compactness < 0.2) {
    recommendations.push(
      "Layout is very spread out - increase spacing or try tree layout for more compact result"
    );
  } else if (stats.compactness > 0.8) {
    recommendations.push(
      "Layout is very dense - decrease spacing for better readability"
    );
  }

  if (stats.readability < 0.6) {
    recommendations.push(
      "Layout readability is low - try adjusting spacing or using a different layout style"
    );
  }

  if (stats.boundingBoxAspectRatio > 3 || stats.boundingBoxAspectRatio < 0.33) {
    recommendations.push(
      "Layout aspect ratio is unbalanced - adjust horizontal/vertical spacing"
    );
  }

  if (recommendations.length === 0) {
    recommendations.push("Layout looks good - no major issues detected");
  }

  return recommendations;
}

/**
 * Format statistics for display
 */
export function formatStatistics(
  stats: LayoutStatistics
): Record<string, string> {
  return {
    Nodes: stats.nodeCount.toString(),
    Edges: stats.edgeCount.toString(),
    Overlaps: stats.nodesOverlapping.toString(),
    "Edge Crossings": stats.edgeCrossings.toString(),
    "Avg Edge Length": `${Math.round(stats.averageEdgeLength)}px`,
    "Canvas Size": `${Math.round(stats.canvasWidth)} × ${Math.round(stats.canvasHeight)}`,
    Utilization: `${Math.round(stats.canvasUtilization * 100)}%`,
    "Layout Score": `${Math.round(stats.layoutScore)}/100`,
    Compactness: `${Math.round(stats.compactness * 100)}%`,
    Readability: `${Math.round(stats.readability * 100)}%`,
  };
}
