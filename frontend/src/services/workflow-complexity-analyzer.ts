/**
 * Workflow Complexity Analyzer
 *
 * Analyzes workflow complexity using graph algorithms and provides
 * metrics, scoring, and suggestions for simplification.
 *
 * Complexity Scoring Algorithm:
 * - Action count weight: 20%
 * - Connection count weight: 15%
 * - Max depth weight: 25%
 * - Branching factor weight: 20%
 * - Cyclomatic complexity weight: 20%
 * - Normalized to 0-100 scale
 */

import { Workflow, Action, Connections } from '@/lib/action-schema/action-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Complexity rating levels
 */
export type ComplexityRating = 'low' | 'medium' | 'high' | 'very-high';

/**
 * Complete complexity analysis result
 */
export interface ComplexityAnalysis {
  /** Number of actions in workflow */
  actionCount: number;

  /** Number of connections in workflow */
  connectionCount: number;

  /** Maximum depth (longest path) */
  maxDepth: number;

  /** Average branches per node */
  branchingFactor: number;

  /** Cyclomatic complexity (decision points) */
  cyclomaticComplexity: number;

  /** Overall complexity score (0-100) */
  complexityScore: number;

  /** Complexity rating */
  complexityRating: ComplexityRating;

  /** Number of control flow actions */
  controlFlowCount: number;

  /** Number of disconnected components */
  disconnectedComponents: number;

  /** Whether workflow has cycles */
  hasCycles: boolean;
}

/**
 * Complexity comparison result
 */
export interface ComplexityComparison {
  /** First workflow analysis */
  workflow1: ComplexityAnalysis & { workflowId: string; workflowName: string };

  /** Second workflow analysis */
  workflow2: ComplexityAnalysis & { workflowId: string; workflowName: string };

  /** Differences between workflows */
  differences: {
    actionCountDiff: number;
    connectionCountDiff: number;
    maxDepthDiff: number;
    branchingFactorDiff: number;
    cyclomaticComplexityDiff: number;
    complexityScoreDiff: number;
  };

  /** Which workflow is more complex */
  moreComplex: 'workflow1' | 'workflow2' | 'equal';
}

/**
 * Complexity distribution data for histograms
 */
export interface ComplexityDistribution {
  /** Distribution by rating */
  byRating: {
    low: number;
    medium: number;
    high: number;
    'very-high': number;
  };

  /** Distribution by score ranges */
  byScore: {
    '0-25': number;
    '26-50': number;
    '51-75': number;
    '76-100': number;
  };

  /** Total workflows analyzed */
  total: number;

  /** Average complexity score */
  averageScore: number;
}

/**
 * Complexity trend data point
 */
export interface ComplexityTrendPoint {
  /** Version or timestamp */
  version: string;

  /** Complexity score at this point */
  complexityScore: number;

  /** Action count at this point */
  actionCount: number;

  /** When this version was recorded */
  timestamp: string;
}

/**
 * Simplification suggestion
 */
export interface SimplificationSuggestion {
  /** Type of suggestion */
  type:
    | 'reduce-depth'
    | 'reduce-branching'
    | 'extract-subworkflow'
    | 'simplify-control-flow'
    | 'remove-dead-code'
    | 'combine-actions';

  /** Severity/priority */
  severity: 'low' | 'medium' | 'high';

  /** Description of the issue */
  description: string;

  /** Recommendation for improvement */
  recommendation: string;

  /** Affected action IDs */
  affectedActions?: string[];
}

// ============================================================================
// Graph Algorithms
// ============================================================================

/**
 * Build adjacency list from workflow connections
 */
function buildAdjacencyList(workflow: Workflow): Map<string, string[]> {
  const adjacencyList = new Map<string, string[]>();

  // Initialize all nodes
  workflow.actions.forEach((action) => {
    adjacencyList.set(action.id, []);
  });

  // Add edges
  Object.entries(workflow.connections).forEach(([sourceId, outputs]) => {
    const neighbors: string[] = [];

    // Collect all outgoing connections
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const outputType = outputs[type as keyof typeof outputs];
      if (outputType) {
        outputType.forEach((outputGroup) => {
          outputGroup.forEach((conn) => {
            neighbors.push(conn.action);
          });
        });
      }
    });

    adjacencyList.set(sourceId, neighbors);
  });

  return adjacencyList;
}

/**
 * Find all root nodes (nodes with no incoming connections)
 */
function findRootNodes(workflow: Workflow): string[] {
  const hasIncoming = new Set<string>();

  Object.values(workflow.connections).forEach((outputs) => {
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const outputType = outputs[type as keyof typeof outputs];
      if (outputType) {
        outputType.forEach((outputGroup) => {
          outputGroup.forEach((conn) => {
            hasIncoming.add(conn.action);
          });
        });
      }
    });
  });

  return workflow.actions
    .map((a) => a.id)
    .filter((id) => !hasIncoming.has(id));
}

/**
 * Calculate maximum depth using BFS from root nodes
 */
function calculateDepthBFS(workflow: Workflow): number {
  const adjacencyList = buildAdjacencyList(workflow);
  const rootNodes = findRootNodes(workflow);

  if (rootNodes.length === 0 && workflow.actions.length > 0) {
    // If no root nodes but we have actions, there might be cycles
    // Start from first action
    rootNodes.push(workflow.actions[0].id);
  }

  let maxDepth = 0;

  rootNodes.forEach((root) => {
    const queue: Array<{ node: string; depth: number }> = [{ node: root, depth: 1 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;

      if (visited.has(node)) continue;
      visited.add(node);

      maxDepth = Math.max(maxDepth, depth);

      const neighbors = adjacencyList.get(node) || [];
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          queue.push({ node: neighbor, depth: depth + 1 });
        }
      });
    }
  });

  return maxDepth;
}

/**
 * Detect cycles using DFS
 */
function hasCyclesDFS(workflow: Workflow): boolean {
  const adjacencyList = buildAdjacencyList(workflow);
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true; // Cycle detected
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const actionId of workflow.actions.map((a) => a.id)) {
    if (!visited.has(actionId)) {
      if (dfs(actionId)) return true;
    }
  }

  return false;
}

/**
 * Count disconnected components using DFS
 */
function countDisconnectedComponents(workflow: Workflow): number {
  const adjacencyList = buildAdjacencyList(workflow);
  const visited = new Set<string>();
  let componentCount = 0;

  function dfs(node: string): void {
    visited.add(node);
    const neighbors = adjacencyList.get(node) || [];
    neighbors.forEach((neighbor) => {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      }
    });
  }

  workflow.actions.forEach((action) => {
    if (!visited.has(action.id)) {
      componentCount++;
      dfs(action.id);
    }
  });

  return componentCount;
}

// ============================================================================
// Complexity Metrics
// ============================================================================

/**
 * Get total action count
 */
export function getActionCount(workflow: Workflow): number {
  return workflow.actions.length;
}

/**
 * Get total connection count
 */
export function getConnectionCount(workflow: Workflow): number {
  let count = 0;

  Object.values(workflow.connections).forEach((outputs) => {
    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const outputType = outputs[type as keyof typeof outputs];
      if (outputType) {
        outputType.forEach((outputGroup) => {
          count += outputGroup.length;
        });
      }
    });
  });

  return count;
}

/**
 * Calculate maximum depth (longest path through workflow)
 */
export function calculateMaxDepth(workflow: Workflow): number {
  if (workflow.actions.length === 0) return 0;
  return calculateDepthBFS(workflow);
}

/**
 * Calculate average branching factor
 */
export function calculateBranchingFactor(workflow: Workflow): number {
  if (workflow.actions.length === 0) return 0;

  const branchCounts: number[] = [];

  Object.values(workflow.connections).forEach((outputs) => {
    let totalOutputs = 0;

    ['main', 'error', 'success', 'parallel'].forEach((type) => {
      const outputType = outputs[type as keyof typeof outputs];
      if (outputType) {
        outputType.forEach((outputGroup) => {
          totalOutputs += outputGroup.length;
        });
      }
    });

    branchCounts.push(totalOutputs);
  });

  if (branchCounts.length === 0) return 0;

  const sum = branchCounts.reduce((acc, count) => acc + count, 0);
  return sum / branchCounts.length;
}

/**
 * Calculate cyclomatic complexity (number of decision points)
 */
export function calculateCyclomaticComplexity(workflow: Workflow): number {
  // Cyclomatic complexity = E - N + 2P
  // E = edges (connections)
  // N = nodes (actions)
  // P = connected components

  const edges = getConnectionCount(workflow);
  const nodes = workflow.actions.length;
  const components = countDisconnectedComponents(workflow);

  if (nodes === 0) return 0;

  // Traditional formula
  const complexity = edges - nodes + 2 * components;

  // Also count control flow actions as decision points
  const controlFlowActions = workflow.actions.filter((action) =>
    ['IF', 'LOOP', 'SWITCH', 'TRY_CATCH'].includes(action.type)
  );

  // Return the higher of the two calculations
  return Math.max(complexity, controlFlowActions.length);
}

/**
 * Get overall complexity score (0-100)
 *
 * Scoring algorithm:
 * - Action count weight: 20%
 * - Connection count weight: 15%
 * - Max depth weight: 25%
 * - Branching factor weight: 20%
 * - Cyclomatic complexity weight: 20%
 */
export function getComplexityScore(workflow: Workflow): number {
  const actionCount = getActionCount(workflow);
  const connectionCount = getConnectionCount(workflow);
  const maxDepth = calculateMaxDepth(workflow);
  const branchingFactor = calculateBranchingFactor(workflow);
  const cyclomaticComplexity = calculateCyclomaticComplexity(workflow);

  // Normalize each metric to 0-100 scale
  // These thresholds are based on typical workflow sizes
  const normalizeActionCount = Math.min((actionCount / 50) * 100, 100);
  const normalizeConnectionCount = Math.min((connectionCount / 75) * 100, 100);
  const normalizeMaxDepth = Math.min((maxDepth / 15) * 100, 100);
  const normalizeBranchingFactor = Math.min((branchingFactor / 3) * 100, 100);
  const normalizeCyclomaticComplexity = Math.min((cyclomaticComplexity / 20) * 100, 100);

  // Weighted average
  const score =
    normalizeActionCount * 0.2 +
    normalizeConnectionCount * 0.15 +
    normalizeMaxDepth * 0.25 +
    normalizeBranchingFactor * 0.2 +
    normalizeCyclomaticComplexity * 0.2;

  return Math.round(score);
}

/**
 * Get complexity rating based on score
 */
export function getComplexityRating(workflow: Workflow): ComplexityRating {
  const score = getComplexityScore(workflow);

  if (score < 25) return 'low';
  if (score < 50) return 'medium';
  if (score < 75) return 'high';
  return 'very-high';
}

/**
 * Analyze all complexity metrics for a workflow
 */
export function analyzeComplexity(workflow: Workflow): ComplexityAnalysis {
  const actionCount = getActionCount(workflow);
  const connectionCount = getConnectionCount(workflow);
  const maxDepth = calculateMaxDepth(workflow);
  const branchingFactor = calculateBranchingFactor(workflow);
  const cyclomaticComplexity = calculateCyclomaticComplexity(workflow);
  const complexityScore = getComplexityScore(workflow);
  const complexityRating = getComplexityRating(workflow);

  const controlFlowCount = workflow.actions.filter((action) =>
    ['IF', 'LOOP', 'SWITCH', 'TRY_CATCH', 'BREAK', 'CONTINUE'].includes(action.type)
  ).length;

  const disconnectedComponents = countDisconnectedComponents(workflow);
  const hasCycles = hasCyclesDFS(workflow);

  return {
    actionCount,
    connectionCount,
    maxDepth,
    branchingFactor,
    cyclomaticComplexity,
    complexityScore,
    complexityRating,
    controlFlowCount,
    disconnectedComponents,
    hasCycles,
  };
}

/**
 * Compare complexity between two workflows
 */
export function compareComplexity(workflow1: Workflow, workflow2: Workflow): ComplexityComparison {
  const analysis1 = analyzeComplexity(workflow1);
  const analysis2 = analyzeComplexity(workflow2);

  const differences = {
    actionCountDiff: analysis2.actionCount - analysis1.actionCount,
    connectionCountDiff: analysis2.connectionCount - analysis1.connectionCount,
    maxDepthDiff: analysis2.maxDepth - analysis1.maxDepth,
    branchingFactorDiff: analysis2.branchingFactor - analysis1.branchingFactor,
    cyclomaticComplexityDiff: analysis2.cyclomaticComplexity - analysis1.cyclomaticComplexity,
    complexityScoreDiff: analysis2.complexityScore - analysis1.complexityScore,
  };

  let moreComplex: 'workflow1' | 'workflow2' | 'equal' = 'equal';
  if (analysis1.complexityScore > analysis2.complexityScore) {
    moreComplex = 'workflow1';
  } else if (analysis2.complexityScore > analysis1.complexityScore) {
    moreComplex = 'workflow2';
  }

  return {
    workflow1: {
      ...analysis1,
      workflowId: workflow1.id,
      workflowName: workflow1.name,
    },
    workflow2: {
      ...analysis2,
      workflowId: workflow2.id,
      workflowName: workflow2.name,
    },
    differences,
    moreComplex,
  };
}

/**
 * Get workflows above a complexity threshold
 */
export function getComplexWorkflows(
  workflows: Workflow[],
  threshold: number = 50
): Array<{ workflow: Workflow; analysis: ComplexityAnalysis }> {
  return workflows
    .map((workflow) => ({
      workflow,
      analysis: analyzeComplexity(workflow),
    }))
    .filter((item) => item.analysis.complexityScore >= threshold)
    .sort((a, b) => b.analysis.complexityScore - a.analysis.complexityScore);
}

/**
 * Get complexity distribution across multiple workflows
 */
export function getComplexityDistribution(workflows: Workflow[]): ComplexityDistribution {
  const analyses = workflows.map((w) => analyzeComplexity(w));

  const distribution: ComplexityDistribution = {
    byRating: {
      low: 0,
      medium: 0,
      high: 0,
      'very-high': 0,
    },
    byScore: {
      '0-25': 0,
      '26-50': 0,
      '51-75': 0,
      '76-100': 0,
    },
    total: analyses.length,
    averageScore: 0,
  };

  if (analyses.length === 0) return distribution;

  let totalScore = 0;

  analyses.forEach((analysis) => {
    // Count by rating
    distribution.byRating[analysis.complexityRating]++;

    // Count by score
    const score = analysis.complexityScore;
    if (score <= 25) {
      distribution.byScore['0-25']++;
    } else if (score <= 50) {
      distribution.byScore['26-50']++;
    } else if (score <= 75) {
      distribution.byScore['51-75']++;
    } else {
      distribution.byScore['76-100']++;
    }

    totalScore += score;
  });

  distribution.averageScore = Math.round(totalScore / analyses.length);

  return distribution;
}

/**
 * Get complexity trends over time
 */
export function getComplexityTrends(
  workflowId: string,
  history: Array<{ version: string; workflow: Workflow; timestamp: string }>
): ComplexityTrendPoint[] {
  return history.map((entry) => {
    const analysis = analyzeComplexity(entry.workflow);
    return {
      version: entry.version,
      complexityScore: analysis.complexityScore,
      actionCount: analysis.actionCount,
      timestamp: entry.timestamp,
    };
  });
}

/**
 * Generate simplification suggestions for a workflow
 */
export function suggestSimplifications(workflow: Workflow): SimplificationSuggestion[] {
  const analysis = analyzeComplexity(workflow);
  const suggestions: SimplificationSuggestion[] = [];

  // Deep nesting suggestion
  if (analysis.maxDepth > 10) {
    suggestions.push({
      type: 'reduce-depth',
      severity: 'high',
      description: `Workflow has a maximum depth of ${analysis.maxDepth}, which makes it difficult to understand and maintain.`,
      recommendation: 'Consider extracting nested logic into separate sub-workflows or flattening the structure.',
    });
  } else if (analysis.maxDepth > 7) {
    suggestions.push({
      type: 'reduce-depth',
      severity: 'medium',
      description: `Workflow depth is ${analysis.maxDepth}, which is moderately complex.`,
      recommendation: 'Consider simplifying nested control flow structures.',
    });
  }

  // High branching factor
  if (analysis.branchingFactor > 2.5) {
    suggestions.push({
      type: 'reduce-branching',
      severity: 'high',
      description: `Average branching factor is ${analysis.branchingFactor.toFixed(2)}, indicating complex decision logic.`,
      recommendation: 'Consider using lookup tables or extracting decision logic into separate workflows.',
    });
  } else if (analysis.branchingFactor > 1.8) {
    suggestions.push({
      type: 'reduce-branching',
      severity: 'medium',
      description: `Branching factor is ${analysis.branchingFactor.toFixed(2)}, which is moderately complex.`,
      recommendation: 'Review conditional logic and consider simplification.',
    });
  }

  // Large workflow
  if (analysis.actionCount > 30) {
    suggestions.push({
      type: 'extract-subworkflow',
      severity: 'high',
      description: `Workflow contains ${analysis.actionCount} actions, making it difficult to understand at a glance.`,
      recommendation: 'Consider breaking this workflow into smaller, reusable sub-workflows based on logical groupings.',
    });
  } else if (analysis.actionCount > 20) {
    suggestions.push({
      type: 'extract-subworkflow',
      severity: 'medium',
      description: `Workflow has ${analysis.actionCount} actions. Consider modularization.`,
      recommendation: 'Identify logical sections that could be extracted into sub-workflows.',
    });
  }

  // High cyclomatic complexity
  if (analysis.cyclomaticComplexity > 15) {
    suggestions.push({
      type: 'simplify-control-flow',
      severity: 'high',
      description: `Cyclomatic complexity is ${analysis.cyclomaticComplexity}, indicating many decision points.`,
      recommendation: 'Simplify control flow logic, reduce nested conditions, or use table-driven approaches.',
    });
  } else if (analysis.cyclomaticComplexity > 10) {
    suggestions.push({
      type: 'simplify-control-flow',
      severity: 'medium',
      description: `Cyclomatic complexity is ${analysis.cyclomaticComplexity}.`,
      recommendation: 'Consider reducing the number of conditional branches.',
    });
  }

  // Disconnected components (dead code)
  if (analysis.disconnectedComponents > 1) {
    suggestions.push({
      type: 'remove-dead-code',
      severity: 'medium',
      description: `Workflow has ${analysis.disconnectedComponents} disconnected components, suggesting unreachable actions.`,
      recommendation: 'Remove or connect isolated actions that are not part of the main execution flow.',
    });
  }

  // Many control flow actions
  const controlFlowRatio = analysis.controlFlowCount / Math.max(analysis.actionCount, 1);
  if (controlFlowRatio > 0.5) {
    suggestions.push({
      type: 'simplify-control-flow',
      severity: 'medium',
      description: `${Math.round(controlFlowRatio * 100)}% of actions are control flow, suggesting overly complex logic.`,
      recommendation: 'Consider data-driven approaches or simplifying the logic structure.',
    });
  }

  // Cycles detected
  if (analysis.hasCycles) {
    suggestions.push({
      type: 'simplify-control-flow',
      severity: 'low',
      description: 'Workflow contains cycles (loops), which can make execution flow harder to follow.',
      recommendation: 'Ensure loops have clear exit conditions and consider if iteration can be simplified.',
    });
  }

  return suggestions;
}

// ============================================================================
// Export Service Object
// ============================================================================

export const workflowComplexityAnalyzer = {
  analyzeComplexity,
  getActionCount,
  getConnectionCount,
  calculateMaxDepth,
  calculateBranchingFactor,
  calculateCyclomaticComplexity,
  getComplexityScore,
  getComplexityRating,
  compareComplexity,
  getComplexWorkflows,
  getComplexityDistribution,
  getComplexityTrends,
  suggestSimplifications,
};

export default workflowComplexityAnalyzer;
