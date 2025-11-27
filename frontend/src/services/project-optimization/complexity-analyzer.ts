/**
 * Complexity Analyzer Module
 *
 * Responsible for analyzing complexity metrics:
 * - Complexity distribution
 * - High complexity resource detection
 * - Complexity reduction suggestions
 */

import type { Workflow } from '@/lib/action-schema/action-types';
import { workflowComplexityAnalyzer } from '../workflow-complexity-analyzer';
import type { ComplexityReport } from './types';

/**
 * Get complexity distribution
 */
export function getComplexityDistribution(workflows: Workflow[]): ComplexityReport {
  const distribution = workflowComplexityAnalyzer.getComplexityDistribution(workflows);

  const scores = workflows.map(w => workflowComplexityAnalyzer.getComplexityScore(w));
  const sortedScores = [...scores].sort((a, b) => a - b);
  const median = sortedScores.length > 0
    ? sortedScores[Math.floor(sortedScores.length / 2)]
    : 0;

  const highComplexity = workflowComplexityAnalyzer.getComplexWorkflows(workflows, 50)
    .map(item => ({
      id: item.workflow.id,
      name: item.workflow.name,
      type: 'workflow' as const,
      score: item.analysis.complexityScore,
    }));

  return {
    distribution: {
      low: distribution.byRating.low,
      medium: distribution.byRating.medium,
      high: distribution.byRating.high,
      veryHigh: distribution.byRating['very-high'],
    },
    average: distribution.averageScore,
    median,
    highComplexity,
  };
}

/**
 * Find high complexity resources
 */
export function findHighComplexityResources(workflows: Workflow[], threshold: number = 50): Array<{
  id: string;
  name: string;
  type: 'workflow';
  score: number;
}> {
  return workflowComplexityAnalyzer.getComplexWorkflows(workflows, threshold)
    .map(item => ({
      id: item.workflow.id,
      name: item.workflow.name,
      type: 'workflow' as const,
      score: item.analysis.complexityScore,
    }));
}

/**
 * Suggest complexity reductions
 */
export function suggestComplexityReductions(workflow: Workflow): string[] {
  const suggestions = workflowComplexityAnalyzer.suggestSimplifications(workflow);
  return suggestions.map(s => s.recommendation);
}
