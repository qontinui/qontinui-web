/**
 * Pattern detector - identifies control flow patterns (IF, LOOP) in graph workflows
 */

import { Workflow, Action } from "../action-schema/action-types";
import { getActionById, getNextActions } from "../action-schema/workflow-utils";

/**
 * IF pattern structure
 */
export interface IfPattern {
  /**
   * The IF action itself
   */
  ifAction: Action;

  /**
   * Actions in the true branch
   */
  thenBranch: Action[];

  /**
   * Actions in the false branch
   */
  elseBranch: Action[];

  /**
   * Action where branches converge (if any)
   */
  convergenceAction?: Action;
}

/**
 * LOOP pattern structure
 */
export interface LoopPattern {
  /**
   * The LOOP action itself
   */
  loopAction: Action;

  /**
   * Actions in the loop body
   */
  bodyActions: Action[];

  /**
   * Action after the loop exits
   */
  nextAction?: Action;
}

/**
 * Detects control flow patterns in graph workflows
 */
export class PatternDetector {
  /**
   * Detect IF pattern for a given IF action
   */
  detectIfPattern(workflow: Workflow, ifAction: Action): IfPattern | null {
    if (ifAction.type !== "IF") {
      return null;
    }

    if (!workflow.connections) {
      return null;
    }

    const connections = workflow.connections[ifAction.id];
    if (!connections?.main || connections.main.length !== 2) {
      return null;
    }

    // Extract true and false branches
    const trueBranchConnections = connections.main[0];
    const falseBranchConnections = connections.main[1];

    // Get actions in each branch
    const thenBranch = this.extractBranchActions(
      workflow,
      trueBranchConnections && trueBranchConnections.length > 0 && trueBranchConnections[0] ? trueBranchConnections[0].action : null
    );

    const elseBranch = this.extractBranchActions(
      workflow,
      falseBranchConnections && falseBranchConnections.length > 0 && falseBranchConnections[0]
        ? falseBranchConnections[0].action
        : null
    );

    // Find convergence point (if any)
    const convergenceAction = this.findConvergencePoint(
      workflow,
      thenBranch,
      elseBranch
    );

    return {
      ifAction,
      thenBranch,
      elseBranch,
      convergenceAction,
    };
  }

  /**
   * Detect LOOP pattern for a given LOOP action
   */
  detectLoopPattern(
    workflow: Workflow,
    loopAction: Action
  ): LoopPattern | null {
    if (loopAction.type !== "LOOP") {
      return null;
    }

    if (!workflow.connections) {
      return null;
    }

    const connections = workflow.connections[loopAction.id];
    if (!connections?.main || connections.main.length === 0) {
      return null;
    }

    // Get first action in loop body
    const firstOutput = connections.main[0];
    const firstConn = firstOutput?.[0];
    const firstBodyAction = firstConn?.action;
    if (!firstBodyAction) {
      return null;
    }

    // Extract all actions in the loop body
    const bodyActions = this.extractLoopBodyActions(
      workflow,
      loopAction.id,
      firstBodyAction
    );

    // Find action after loop exits
    const nextAction = this.findLoopExitAction(
      workflow,
      loopAction.id
    );

    return {
      loopAction,
      bodyActions,
      nextAction,
    };
  }

  /**
   * Extract actions in a branch until convergence or termination
   */
  private extractBranchActions(
    workflow: Workflow,
    startActionId: string | null
  ): Action[] {
    if (!startActionId) {
      return [];
    }

    const branchActions: Action[] = [];
    const visited = new Set<string>();
    let currentId: string | null = startActionId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);

      const action = getActionById(workflow, currentId);
      if (!action) {
        break;
      }

      branchActions.push(action);

      // Stop at nested control flow (will be processed recursively)
      if (["IF", "LOOP", "SWITCH"].includes(action.type)) {
        // Include the control flow action but don't descend into it
        break;
      }

      // Get next action
      const nextActions = getNextActions(workflow, currentId);

      // If multiple next actions, this might be a branch point - stop here
      if (nextActions.length > 1) {
        break;
      }

      currentId = nextActions.length > 0 ? nextActions[0] || null : null;
    }

    return branchActions;
  }

  /**
   * Find where two branches converge
   */
  private findConvergencePoint(
    workflow: Workflow,
    branch1: Action[],
    branch2: Action[]
  ): Action | undefined {
    // Get all downstream actions from both branches
    const downstream1 = this.getAllDownstreamActions(workflow, branch1);
    const downstream2 = this.getAllDownstreamActions(workflow, branch2);

    // Find first common action
    // Convert Set to Array to avoid iteration issues
    const downstream1Array = Array.from(downstream1);
    for (const actionId of downstream1Array) {
      if (downstream2.has(actionId)) {
        return getActionById(workflow, actionId);
      }
    }

    return undefined;
  }

  /**
   * Get all downstream actions from a set of actions
   */
  private getAllDownstreamActions(
    workflow: Workflow,
    actions: Action[]
  ): Set<string> {
    const downstream = new Set<string>();
    const visited = new Set<string>();

    const traverse = (actionId: string) => {
      if (visited.has(actionId)) {
        return;
      }
      visited.add(actionId);

      const nextActions = getNextActions(workflow, actionId);
      nextActions.forEach((nextId) => {
        downstream.add(nextId);
        traverse(nextId);
      });
    };

    actions.forEach((action) => traverse(action.id));

    return downstream;
  }

  /**
   * Extract all actions in a loop body
   */
  private extractLoopBodyActions(
    workflow: Workflow,
    loopActionId: string,
    firstBodyActionId: string
  ): Action[] {
    const bodyActions: Action[] = [];
    const visited = new Set<string>();

    const traverse = (actionId: string) => {
      if (visited.has(actionId)) {
        return;
      }
      visited.add(actionId);

      const action = getActionById(workflow, actionId);
      if (!action) {
        return;
      }

      // Don't include the loop action itself
      if (actionId === loopActionId) {
        return;
      }

      bodyActions.push(action);

      // Get next actions
      const nextActions = getNextActions(workflow, actionId);
      nextActions.forEach((nextId) => {
        // Stop if we've looped back to the loop action
        if (nextId !== loopActionId) {
          traverse(nextId);
        }
      });
    };

    traverse(firstBodyActionId);

    return bodyActions;
  }

  /**
   * Find the action that executes after the loop exits
   */
  private findLoopExitAction(
    workflow: Workflow,
    loopActionId: string
  ): Action | undefined {
    if (!workflow.connections) {
      return undefined;
    }

    const connections = workflow.connections[loopActionId];
    if (!connections?.main) {
      return undefined;
    }

    // Check for success/exit connections (index 1 if present)
    if (connections.main.length > 1) {
      const exitOutput = connections.main[1];
      if (exitOutput && exitOutput.length > 0) {
        const exitConn = exitOutput[0];
        if (exitConn) {
          return getActionById(workflow, exitConn.action);
        }
      }
    }

    return undefined;
  }

  /**
   * Detect all IF patterns in the workflow
   */
  detectAllIfPatterns(workflow: Workflow): Map<string, IfPattern> {
    const patterns = new Map<string, IfPattern>();
    const ifActions = workflow.actions.filter((a) => a.type === "IF");

    ifActions.forEach((ifAction) => {
      const pattern = this.detectIfPattern(workflow, ifAction);
      if (pattern) {
        patterns.set(ifAction.id, pattern);
      }
    });

    return patterns;
  }

  /**
   * Detect all LOOP patterns in the workflow
   */
  detectAllLoopPatterns(workflow: Workflow): Map<string, LoopPattern> {
    const patterns = new Map<string, LoopPattern>();
    const loopActions = workflow.actions.filter((a) => a.type === "LOOP");

    loopActions.forEach((loopAction) => {
      const pattern = this.detectLoopPattern(workflow, loopAction);
      if (pattern) {
        patterns.set(loopAction.id, pattern);
      }
    });

    return patterns;
  }
}
