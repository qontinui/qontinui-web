/**
 * Graph to Sequential Converter
 *
 * Converts graph workflows to sequential format when possible.
 * Detects if a graph can be linearized and produces sequential action lists.
 */

import { Workflow, Action, Connections } from "../action-schema/action-types";
import {
  getTopologicalOrder,
  getActionById,
} from "../action-schema/workflow-utils";
import {
  LinearizabilityChecker,
  LinearizabilityResult,
} from "./linearizability-checker";
import { PatternDetector } from "./pattern-detector";
import { NonLinearWorkflowError, WorkflowValidationError } from "./errors";

/**
 * Conversion options
 */
export interface ConversionOptions {
  /**
   * Whether to preserve action IDs from the graph workflow
   * @default true
   */
  preserveIds?: boolean;

  /**
   * Whether to preserve action names
   * @default true
   */
  preserveNames?: boolean;

  /**
   * Whether to validate the resulting sequential workflow
   * @default true
   */
  validateOutput?: boolean;
}

/**
 * Converts graph workflows to sequential format
 */
export class GraphToSequentialConverter {
  private checker = new LinearizabilityChecker();
  private detector = new PatternDetector();

  /**
   * Convert graph workflow to sequential format
   *
   * @throws {WorkflowValidationError} If workflow is invalid
   * @throws {NonLinearWorkflowError} If workflow cannot be linearized
   */
  convert(workflow: Workflow, options: ConversionOptions = {}): Action[] {
    const opts: Required<ConversionOptions> = {
      preserveIds: options.preserveIds ?? true,
      preserveNames: options.preserveNames ?? true,
      validateOutput: options.validateOutput ?? true,
    };

    // Step 1: Validate it's a graph workflow
    if (workflow.format !== "graph") {
      throw new WorkflowValidationError("Workflow is not in graph format", {
        format: workflow.format,
      });
    }

    if (
      !workflow.connections ||
      Object.keys(workflow.connections).length === 0
    ) {
      throw new WorkflowValidationError("Graph workflow has no connections");
    }

    // Step 2: Check if linearizable
    const linearizabilityResult = this.checker.check(workflow);
    if (!linearizabilityResult.linearizable) {
      throw new NonLinearWorkflowError(
        "Workflow cannot be converted to sequential format",
        linearizabilityResult.issues
      );
    }

    // Step 3: Topological sort
    const sortedActions = this.topologicalSort(workflow);

    // Step 4: Rebuild nested structures (IF, LOOP)
    const sequentialActions = this.rebuildControlFlow(
      sortedActions,
      workflow.connections,
      workflow
    );

    // Step 5: Clean up actions (remove positions, etc.)
    const cleanedActions = this.cleanupActions(sequentialActions, opts);

    // Step 6: Validate output
    if (opts.validateOutput) {
      this.validateSequentialWorkflow(cleanedActions);
    }

    return cleanedActions;
  }

  /**
   * Check if workflow can be linearized
   */
  canLinearize(workflow: Workflow): LinearizabilityResult {
    if (workflow.format !== "graph") {
      return {
        linearizable: false,
        issues: ["Workflow is not in graph format"],
      };
    }

    return this.checker.check(workflow);
  }

  /**
   * Topological sort of actions
   */
  private topologicalSort(workflow: Workflow): Action[] {
    const order = getTopologicalOrder(workflow);
    if (!order) {
      throw new NonLinearWorkflowError(
        "Cannot sort workflow: contains cycles",
        ["Cyclic dependencies detected"]
      );
    }

    const sortedActions: Action[] = [];
    order.forEach((actionId) => {
      const action = getActionById(workflow, actionId);
      if (action) {
        sortedActions.push(action);
      }
    });

    return sortedActions;
  }

  /**
   * Rebuild control flow structures (IF, LOOP)
   */
  private rebuildControlFlow(
    actions: Action[],
    _connections: Connections,
    workflow: Workflow
  ): Action[] {
    const result: Action[] = [];
    const processedActions = new Set<string>();

    for (const action of actions) {
      // Skip if already processed
      if (processedActions.has(action.id)) {
        continue;
      }

      // Handle control flow actions
      if (action.type === "IF") {
        const reconstructed = this.reconstructIf(
          action,
          workflow,
          processedActions
        );
        result.push(reconstructed);
      } else if (action.type === "LOOP") {
        const reconstructed = this.reconstructLoop(
          action,
          workflow,
          processedActions
        );
        result.push(reconstructed);
      } else {
        // Regular action
        result.push(action);
        processedActions.add(action.id);
      }
    }

    return result;
  }

  /**
   * Reconstruct IF action with nested thenActions and elseActions
   */
  private reconstructIf(
    ifAction: Action,
    workflow: Workflow,
    processedActions: Set<string>
  ): Action {
    const pattern = this.detector.detectIfPattern(workflow, ifAction);
    if (!pattern) {
      // No pattern found, return action as-is
      processedActions.add(ifAction.id);
      return ifAction;
    }

    // Mark all actions in branches as processed
    processedActions.add(ifAction.id);
    pattern.thenBranch.forEach((a) => processedActions.add(a.id));
    pattern.elseBranch.forEach((a) => processedActions.add(a.id));

    // Recursively process nested control flow
    const thenActions = this.rebuildControlFlow(
      pattern.thenBranch,
      workflow.connections!,
      workflow
    );
    const elseActions = this.rebuildControlFlow(
      pattern.elseBranch,
      workflow.connections!,
      workflow
    );

    // Convert Action[] to string[] (action IDs)
    // In sequential format, IF config uses action IDs
    return {
      ...ifAction,
      config: {
        ...ifAction.config,
        thenActions: thenActions.map((a) => a.id),
        elseActions: elseActions.map((a) => a.id),
      },
    } as Action;
  }

  /**
   * Reconstruct LOOP action with nested actions array
   */
  private reconstructLoop(
    loopAction: Action,
    workflow: Workflow,
    processedActions: Set<string>
  ): Action {
    const pattern = this.detector.detectLoopPattern(workflow, loopAction);
    if (!pattern) {
      // No pattern found, return action as-is
      processedActions.add(loopAction.id);
      return loopAction;
    }

    // Mark all actions in loop body as processed
    processedActions.add(loopAction.id);
    pattern.bodyActions.forEach((a) => processedActions.add(a.id));

    // Recursively process nested control flow
    const bodyActions = this.rebuildControlFlow(
      pattern.bodyActions,
      workflow.connections!,
      workflow
    );

    // Convert Action[] to string[] (action IDs)
    return {
      ...loopAction,
      config: {
        ...loopAction.config,
        actions: bodyActions.map((a) => a.id),
      },
    } as Action;
  }

  /**
   * Cleanup actions for sequential format
   */
  private cleanupActions(
    actions: Action[],
    options: Required<ConversionOptions>
  ): Action[] {
    return actions.map((action) => {
      // Create a new action without graph-specific properties
      const cleaned: unknown = {
        id: action.id,
        type: action.type,
        config: action.config,
      };

      if (options.preserveNames && action.name) {
        cleaned.name = action.name;
      }

      if (action.base) {
        cleaned.base = action.base;
      }

      if (action.execution) {
        cleaned.execution = action.execution;
      }

      // Remove position property (graph-specific)
      // Position is optional in the Action type, so we don't include it

      return cleaned as Action;
    });
  }

  /**
   * Validate sequential workflow structure
   */
  private validateSequentialWorkflow(actions: Action[]): void {
    // Check for valid action structure
    actions.forEach((action, index) => {
      if (!action.id) {
        throw new WorkflowValidationError(
          `Action at index ${index} missing ID`
        );
      }

      if (!action.type) {
        throw new WorkflowValidationError(`Action ${action.id} missing type`);
      }

      if (!action.config) {
        throw new WorkflowValidationError(`Action ${action.id} missing config`);
      }
    });

    // Check for duplicate IDs
    const ids = new Set<string>();
    actions.forEach((action) => {
      if (ids.has(action.id)) {
        throw new WorkflowValidationError(`Duplicate action ID: ${action.id}`);
      }
      ids.add(action.id);
    });

    // Validate control flow references
    actions.forEach((action) => {
      if (action.type === "IF") {
        const config = action.config as unknown;
        if (config.thenActions) {
          this.validateActionReferences(config.thenActions, ids, action.id);
        }
        if (config.elseActions) {
          this.validateActionReferences(config.elseActions, ids, action.id);
        }
      } else if (action.type === "LOOP") {
        const config = action.config as unknown;
        if (config.actions) {
          this.validateActionReferences(config.actions, ids, action.id);
        }
      }
    });
  }

  /**
   * Validate action references
   */
  private validateActionReferences(
    references: string[],
    validIds: Set<string>,
    parentActionId: string
  ): void {
    references.forEach((ref) => {
      if (!validIds.has(ref)) {
        throw new WorkflowValidationError(
          `Action ${parentActionId} references non-existent action: ${ref}`
        );
      }
    });
  }
}
