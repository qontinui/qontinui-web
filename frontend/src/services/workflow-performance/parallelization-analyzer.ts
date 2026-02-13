/**
 * Parallelization Analyzer
 *
 * Analyzes workflows for parallelization opportunities, validates potential
 * parallel execution groups, and estimates speedup from parallelization.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type { ParallelizationOpportunity } from "./types";
import {
  buildDependencyGraph,
  findIndependentActions,
  estimateActionTime,
} from "./helpers";

export class ParallelizationAnalyzer {
  /**
   * Analyze parallelization opportunities
   */
  analyzeParallelizationOpportunities(
    workflow: Workflow
  ): ParallelizationOpportunity[] {
    const opportunities: ParallelizationOpportunity[] = [];
    const parallelGroups = this.findParallelizableActions(workflow);

    for (const group of parallelGroups) {
      if (group.length < 2) continue;

      const estimatedSpeedup = this.estimateParallelSpeedup(workflow, group);

      opportunities.push({
        groups: [group],
        estimatedSpeedup,
        reason:
          "These actions have no data dependencies and can execute simultaneously",
        caveats: [
          "Ensure actions don't interfere with each other",
          "Consider system resource limits",
          "Test thoroughly after parallelization",
        ],
      });
    }

    return opportunities;
  }

  /**
   * Find groups of actions that can be parallelized
   */
  findParallelizableActions(workflow: Workflow): string[][] {
    const groups: string[][] = [];
    const visited = new Set<string>();

    // Build dependency graph
    const dependencies = buildDependencyGraph(workflow);

    for (const action of workflow.actions) {
      if (visited.has(action.id)) continue;

      // Find all actions at the same "level" (no dependencies between them)
      const group = findIndependentActions(
        workflow,
        action.id,
        dependencies,
        visited
      );

      if (group.length >= 2) {
        groups.push(group);
        group.forEach((id) => visited.add(id));
      }
    }

    return groups;
  }

  /**
   * Validate if actions can be parallelized
   */
  validateParallelization(
    workflow: Workflow,
    actionIds: string[]
  ): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for data dependencies
    const dependencies = buildDependencyGraph(workflow);

    for (let i = 0; i < actionIds.length; i++) {
      for (let j = i + 1; j < actionIds.length; j++) {
        const id1 = actionIds[i] ?? "";
        const id2 = actionIds[j] ?? "";

        if (
          dependencies.get(id1)?.has(id2) ||
          dependencies.get(id2)?.has(id1)
        ) {
          issues.push(`Actions ${id1} and ${id2} have data dependencies`);
        }
      }
    }

    // Check for conflicting operations
    const actions = actionIds
      .map((id) => workflow.actions.find((a) => a.id === id)!)
      .filter(Boolean);
    const hasMouseActions = actions.some((a) =>
      ["CLICK", "MOUSE_MOVE", "DRAG"].includes(a.type)
    );
    const hasKeyboardActions = actions.some((a) =>
      ["TYPE", "KEY_PRESS", "HOTKEY"].includes(a.type)
    );

    if (hasMouseActions && hasKeyboardActions) {
      issues.push("Mouse and keyboard actions may interfere with each other");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Estimate speedup from parallelization
   */
  estimateParallelSpeedup(
    workflow: Workflow,
    parallelActionIds: string[]
  ): number {
    let totalSequentialTime = 0;

    for (const actionId of parallelActionIds) {
      const action = workflow.actions.find((a) => a.id === actionId);
      if (action) {
        totalSequentialTime += estimateActionTime(action);
      }
    }

    // Assume parallel execution takes as long as the longest action
    const longestTime = Math.max(
      ...parallelActionIds.map((id) => {
        const action = workflow.actions.find((a) => a.id === id);
        return action ? estimateActionTime(action) : 0;
      })
    );

    return totalSequentialTime - longestTime;
  }

  /**
   * Suggest parallel branches
   */
  suggestParallelBranches(workflow: Workflow): Array<{
    actionIds: string[];
    reason: string;
  }> {
    const branches: Array<{ actionIds: string[]; reason: string }> = [];
    const parallelGroups = this.findParallelizableActions(workflow);

    for (const group of parallelGroups) {
      if (group.length >= 2) {
        branches.push({
          actionIds: group,
          reason: "These actions have no data dependencies",
        });
      }
    }

    return branches;
  }
}
