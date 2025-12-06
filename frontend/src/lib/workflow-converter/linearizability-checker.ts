/**
 * Linearizability checker - determines if a graph workflow can be converted to sequential format
 */

import { Workflow } from "../action-schema/action-types";
import {
  getEntryPoints,
  getNextActions,
  hasCycles,
} from "../action-schema/workflow-utils";

/**
 * Result of linearizability check
 */
export interface LinearizabilityResult {
  /**
   * Whether the workflow can be linearized
   */
  linearizable: boolean;

  /**
   * List of issues preventing linearization
   */
  issues: string[];

  /**
   * Additional details about the analysis
   */
  details?: {
    entryPointCount: number;
    branchingNodeCount: number;
    mergeNodeCount: number;
    parallelBranchCount: number;
    cycleCount: number;
  };
}

/**
 * Checks if a graph workflow can be linearized
 */
export class LinearizabilityChecker {
  /**
   * Check if workflow can be linearized
   */
  check(workflow: Workflow): LinearizabilityResult {
    const issues: string[] = [];
    const details = {
      entryPointCount: 0,
      branchingNodeCount: 0,
      mergeNodeCount: 0,
      parallelBranchCount: 0,
      cycleCount: 0,
    };

    // Graph workflows are always in graph format (no sequential format support)
    if (workflow.format !== "graph") {
      issues.push("Workflow is not in graph format");
      return { linearizable: false, issues, details };
    }

    // Must have connections
    if (
      !workflow.connections ||
      Object.keys(workflow.connections).length === 0
    ) {
      issues.push("Graph workflow has no connections");
      return { linearizable: false, issues, details };
    }

    // Check 1: Multiple entry points
    const entryPoints = getEntryPoints(workflow);
    details.entryPointCount = entryPoints.length;
    if (entryPoints.length === 0) {
      issues.push("No entry points detected");
    } else if (entryPoints.length > 1) {
      issues.push(
        `Multiple entry points detected: ${entryPoints.join(", ")} (only one allowed)`
      );
    }

    // Check 2: Branching nodes (actions with multiple outputs)
    const branchingNodes = this.findBranchingNodes(workflow);
    details.branchingNodeCount = branchingNodes.length;

    // Check 3: Merge nodes (actions with multiple inputs)
    const mergeNodes = this.findMergeNodes(workflow);
    details.mergeNodeCount = mergeNodes.length;
    if (mergeNodes.length > 0) {
      issues.push(
        `Merge nodes detected: ${mergeNodes.join(", ")} (multiple paths converge to same action)`
      );
    }

    // Check 4: Parallel execution
    const parallelBranches = this.findParallelBranches(workflow);
    details.parallelBranchCount = parallelBranches.length;
    if (parallelBranches.length > 0) {
      issues.push(
        `Parallel execution detected at actions: ${parallelBranches.join(", ")} (only sequential allowed)`
      );
    }

    // Check 5: Cycles (except valid LOOP back-edges)
    const cycles = this.detectNonLoopCycles(workflow);
    details.cycleCount = cycles.length;
    if (cycles.length > 0) {
      issues.push(
        `Non-LOOP cycles detected: ${cycles.join(", ")} (circular dependencies)`
      );
    }

    // Check 6: IF branches must eventually converge or terminate
    const ifIssues = this.checkIfBranchStructure(workflow);
    issues.push(...ifIssues);

    return {
      linearizable: issues.length === 0,
      issues,
      details,
    };
  }

  /**
   * Find all branching nodes (actions with multiple outgoing connections)
   */
  private findBranchingNodes(workflow: Workflow): string[] {
    if (!workflow.connections) {
      return [];
    }

    const branchingNodes: string[] = [];

    Object.entries(workflow.connections).forEach(([actionId, outputs]) => {
      // Count total outputs across all output types
      let outputCount = 0;
      ["main", "error", "success", "parallel"].forEach((type) => {
        const connections = outputs[type as keyof typeof outputs];
        if (connections) {
          connections.forEach((outputConnections) => {
            outputCount += outputConnections.length;
          });
        }
      });

      // If action has more than one output, it's a branching node
      if (outputCount > 1) {
        branchingNodes.push(actionId);
      }
    });

    return branchingNodes;
  }

  /**
   * Find all merge nodes (actions with multiple incoming connections)
   */
  private findMergeNodes(workflow: Workflow): string[] {
    if (!workflow.connections) {
      return [];
    }

    const incomingCounts = new Map<string, number>();

    // Count incoming connections for each action
    Object.values(workflow.connections).forEach((outputs) => {
      ["main", "error", "success", "parallel"].forEach((type) => {
        const connections = outputs[type as keyof typeof outputs];
        if (connections) {
          connections.forEach((outputConnections) => {
            outputConnections.forEach((conn) => {
              const count = incomingCounts.get(conn.action) || 0;
              incomingCounts.set(conn.action, count + 1);
            });
          });
        }
      });
    });

    // Find actions with more than one incoming connection
    const mergeNodes: string[] = [];
    incomingCounts.forEach((count, actionId) => {
      if (count > 1) {
        mergeNodes.push(actionId);
      }
    });

    return mergeNodes;
  }

  /**
   * Find all parallel execution branches
   */
  private findParallelBranches(workflow: Workflow): string[] {
    if (!workflow.connections) {
      return [];
    }

    const parallelActions: string[] = [];

    Object.entries(workflow.connections).forEach(([actionId, outputs]) => {
      // Check for multiple outputs on same output type (fan-out)
      if (outputs.main && outputs.main.length > 1) {
        // For IF/SWITCH, multiple outputs are expected
        const action = workflow.actions.find((a) => a.id === actionId);
        if (action && !["IF", "SWITCH", "TRY_CATCH"].includes(action.type)) {
          parallelActions.push(actionId);
        }
      }
    });

    return parallelActions;
  }

  /**
   * Detect cycles that are not valid LOOP back-edges
   */
  private detectNonLoopCycles(workflow: Workflow): string[] {
    // First, check if workflow has any cycles at all
    if (!hasCycles(workflow)) {
      return [];
    }

    // If there are cycles, we need to check if they're all valid LOOP back-edges
    const loopActions = workflow.actions.filter((a) => a.type === "LOOP");

    // For each cycle, check if it's a valid LOOP back-edge
    // For now, we'll use a simplified approach:
    // - Find all cycles using DFS
    // - Check if each cycle starts and ends at a LOOP action

    const cycles = this.findAllCycles(workflow);
    const invalidCycles: string[] = [];

    cycles.forEach((cycle, index) => {
      // Check if this cycle is a valid LOOP back-edge
      const isValidLoop = loopActions.some((loopAction) => {
        // A valid LOOP cycle starts and ends at the same LOOP action
        return (
          cycle[0] === loopAction.id &&
          cycle[cycle.length - 1] === loopAction.id
        );
      });

      if (!isValidLoop) {
        invalidCycles.push(`cycle-${index + 1}(${cycle.join("->")})`);
      }
    });

    return invalidCycles;
  }

  /**
   * Find all cycles in the workflow graph
   */
  private findAllCycles(workflow: Workflow): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack: string[] = [];

    const dfs = (actionId: string) => {
      if (recursionStack.includes(actionId)) {
        // Found a cycle
        const cycleStart = recursionStack.indexOf(actionId);
        const cycle = recursionStack.slice(cycleStart);
        cycle.push(actionId); // Complete the cycle
        cycles.push(cycle);
        return;
      }

      if (visited.has(actionId)) {
        return;
      }

      visited.add(actionId);
      recursionStack.push(actionId);

      const nextActions = getNextActions(workflow, actionId);
      nextActions.forEach(dfs);

      recursionStack.pop();
    };

    const entryPoints = getEntryPoints(workflow);
    entryPoints.forEach(dfs);

    return cycles;
  }

  /**
   * Check IF branch structure
   * Both branches must eventually converge to the same action or terminate
   */
  private checkIfBranchStructure(workflow: Workflow): string[] {
    const issues: string[] = [];
    const ifActions = workflow.actions.filter((a) => a.type === "IF");

    if (!workflow.connections) {
      return issues;
    }

    ifActions.forEach((ifAction) => {
      const connections = workflow.connections![ifAction.id];
      if (!connections?.main || connections.main.length !== 2) {
        issues.push(
          `IF action ${ifAction.id} must have exactly 2 outputs (true/false branches)`
        );
        return;
      }

      // For linearizability, both branches should:
      // 1. Lead to the same action (convergence), OR
      // 2. Both terminate (no outgoing connections), OR
      // 3. Both are mutually exclusive paths that never merge

      // For simplicity, we'll check that neither branch creates merge nodes
      // (which is already checked elsewhere)

      // Additional check: ensure both branches have connections
      const trueBranch = connections.main[0];
      const falseBranch = connections.main[1];

      if (
        trueBranch &&
        falseBranch &&
        trueBranch.length === 0 &&
        falseBranch.length === 0
      ) {
        issues.push(`IF action ${ifAction.id} has no outgoing connections`);
      }
    });

    return issues;
  }
}
