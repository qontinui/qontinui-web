/**
 * Suggestion Generator
 *
 * Generates optimization suggestions (8 types) with priority levels
 * based on workflow analysis including parallelization, loop optimization,
 * screenshot reduction, workflow splitting, error handling, redundancy,
 * sequential FIND actions, and missing FIND actions.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type { OptimizationSuggestion } from "./types";
import { BottleneckAnalyzer } from "./bottleneck-analyzer";
import { ParallelizationAnalyzer } from "./parallelization-analyzer";
import { WaitAnalyzer } from "./wait-analyzer";
import {
  getActionsByType,
  hasErrorHandling,
  findSequentialFindActions,
} from "./helpers";

export class SuggestionGenerator {
  private readonly bottleneckAnalyzer = new BottleneckAnalyzer();
  private readonly parallelizationAnalyzer = new ParallelizationAnalyzer();
  private readonly waitAnalyzer = new WaitAnalyzer();

  /**
   * Generate optimization suggestions
   */
  generateSuggestions(
    workflow: Workflow,
    _executionData?: unknown
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 1. Parallelization suggestions
    const parallelGroups =
      this.parallelizationAnalyzer.findParallelizableActions(workflow);
    for (const group of parallelGroups) {
      if (group.length >= 2) {
        const speedup = this.parallelizationAnalyzer.estimateParallelSpeedup(
          workflow,
          group
        );
        suggestions.push({
          type: "parallelize",
          priority: 5,
          actionIds: group,
          title: `Parallelize ${group.length} independent actions`,
          description: `These actions have no dependencies and can run simultaneously`,
          expectedSpeedup: `${speedup}ms`,
          difficulty: 2,
        });
      }
    }

    // 2. Wait replacement suggestions (deprecated - WAIT action type removed)
    // This section is kept for backward compatibility but does nothing

    // 3. Loop optimization suggestions
    suggestions.push(...this.waitAnalyzer.suggestLoopOptimizations(workflow));

    // 3. Screenshot reduction
    const screenshotCount = getActionsByType(workflow, "SCREENSHOT").length;
    if (screenshotCount > 5) {
      suggestions.push({
        type: "reduce_screenshots",
        priority: 3,
        actionIds: getActionsByType(workflow, "SCREENSHOT").map((a) => a.id),
        title: `Reduce number of screenshot operations`,
        description: `Workflow has ${screenshotCount} screenshot actions, which may impact performance`,
        difficulty: 2,
      });
    }

    // 4. Workflow splitting
    if (workflow.actions.length > 50) {
      suggestions.push({
        type: "split_workflow",
        priority: 3,
        actionIds: [],
        title: "Consider splitting into smaller workflows",
        description: `Workflow has ${workflow.actions.length} actions. Breaking it into smaller, focused workflows may improve maintainability and performance.`,
        difficulty: 4,
      });
    }

    // 5. Error handling
    const actionsWithoutErrorHandling = workflow.actions.filter(
      (a) => !hasErrorHandling(workflow, a.id)
    );
    if (actionsWithoutErrorHandling.length > workflow.actions.length * 0.5) {
      suggestions.push({
        type: "add_error_handling",
        priority: 3,
        actionIds: actionsWithoutErrorHandling.map((a) => a.id),
        title: "Add error handling",
        description:
          "Many actions lack error handling, which can cause delays during failures",
        difficulty: 3,
      });
    }

    // 6. Redundant operations
    const redundantGroups =
      this.bottleneckAnalyzer.getRedundantOperations(workflow);
    for (const group of redundantGroups) {
      suggestions.push({
        type: "remove_redundant",
        priority: 4,
        actionIds: group.map((a) => a.id),
        title: "Remove or cache redundant operations",
        description: `${group.length} actions have identical configurations. Consider caching or removing duplicates.`,
        difficulty: 2,
      });
    }

    // 7. Sequential FIND actions
    const findSequences = findSequentialFindActions(workflow);
    if (findSequences.length > 3) {
      suggestions.push({
        type: "parallelize",
        priority: 4,
        actionIds: findSequences,
        title: "Too many sequential FIND actions",
        description:
          "Multiple FIND actions in sequence can be slow. Consider restructuring or combining them.",
        difficulty: 3,
      });
    }

    // 8. Missing FIND actions
    const waitAnalysis = this.waitAnalyzer.analyzeWaitActions(workflow);
    for (const missing of waitAnalysis.missingWaits) {
      suggestions.push({
        type: "add_wait",
        priority: 2,
        actionIds: [missing.actionId],
        title: "Consider adding FIND action",
        description: missing.reason,
        difficulty: 1,
      });
    }

    // Sort by priority
    suggestions.sort((a, b) => b.priority - a.priority);

    return suggestions;
  }
}
