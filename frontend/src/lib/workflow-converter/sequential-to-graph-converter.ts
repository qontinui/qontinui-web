/**
 * Sequential to Graph Workflow Converter
 *
 * Converts sequential (array-based) workflows into graph-based workflows
 * with proper connections, positions, and control flow handling.
 *
 * @example
 * const converter = new SequentialToGraphConverter();
 * const graphWorkflow = converter.convert(sequentialActions);
 */

import {
  Action,
  ActionType,
  Connection,
  Connections,
  Workflow,
} from "../action-schema/action-types";
import {
  IfActionConfig,
  LoopActionConfig,
  SwitchActionConfig,
  TryCatchActionConfig,
} from "../action-schema/configs/control-flow-actions";
import { AutoLayout } from "./auto-layout";

/**
 * Converter options
 */
export interface ConverterOptions {
  /** Workflow name for generated workflow */
  workflowName?: string;

  /** Workflow ID for generated workflow */
  workflowId?: string;

  /** Workflow version */
  version?: string;

  /** Whether to preserve original action IDs */
  preserveActionIds?: boolean;

  /** Auto-layout options */
  layout?: {
    /** Horizontal spacing between nodes */
    horizontalSpacing?: number;

    /** Vertical spacing for branches */
    verticalSpacing?: number;

    /** Starting X position */
    startX?: number;

    /** Starting Y position */
    startY?: number;
  };
}

/**
 * Conversion result with metadata
 */
export interface ConversionResult {
  /** The converted workflow */
  workflow: Workflow;

  /** Conversion statistics */
  stats: {
    /** Number of actions converted */
    actionsConverted: number;

    /** Number of connections created */
    connectionsCreated: number;

    /** Number of control flow actions expanded */
    controlFlowExpanded: number;

    /** Depth of the longest path */
    maxDepth: number;
  };

  /** Any warnings during conversion */
  warnings: string[];
}

/**
 * Internal action node with metadata for layout
 */
interface ActionNode {
  action: Action;
  depth: number;
  verticalOffset: number;
  isControlFlow: boolean;
  parentId?: string;
}

/**
 * Sequential to Graph Workflow Converter
 *
 * Converts sequential action lists into graph format workflows with:
 * - Automatic connection generation
 * - Control flow handling (IF, LOOP, SWITCH, TRY_CATCH)
 * - Auto-layout positioning
 * - Validation
 */
export class SequentialToGraphConverter {
  private readonly options: Required<ConverterOptions>;
  private actionNodes: Map<string, ActionNode> = new Map();
  private connections: Connections = {};
  private warnings: string[] = [];
  private stats = {
    actionsConverted: 0,
    connectionsCreated: 0,
    controlFlowExpanded: 0,
    maxDepth: 0,
  };

  constructor(options: ConverterOptions = {}) {
    this.options = {
      workflowName: options.workflowName || "Converted Workflow",
      workflowId: options.workflowId || this.generateId("workflow"),
      version: options.version || "1.0.0",
      preserveActionIds: options.preserveActionIds ?? false,
      layout: {
        horizontalSpacing: options.layout?.horizontalSpacing ?? 200,
        verticalSpacing: options.layout?.verticalSpacing ?? 150,
        startX: options.layout?.startX ?? 100,
        startY: options.layout?.startY ?? 100,
      },
    };
  }

  /**
   * Convert sequential actions to graph workflow
   *
   * @param actions - Sequential action list
   * @returns Conversion result with workflow and metadata
   *
   * @example
   * const result = converter.convert([action1, action2, action3]);
   * console.log(result.workflow);
   * console.log(`Converted ${result.stats.actionsConverted} actions`);
   */
  convert(actions: Action[]): ConversionResult {
    // Reset state
    this.actionNodes.clear();
    this.connections = {};
    this.warnings = [];
    this.stats = {
      actionsConverted: 0,
      connectionsCreated: 0,
      controlFlowExpanded: 0,
      maxDepth: 0,
    };

    // Validate input
    if (!actions || !Array.isArray(actions)) {
      throw new Error("Actions must be an array");
    }

    if (actions.length === 0) {
      this.warnings.push("Empty action list provided");
    }

    // Process all actions and build node graph
    this.processActions(actions, 0, 0);

    // Build linear connections
    this.buildLinearConnections(actions);

    // Calculate positions using auto-layout
    this.assignPositions();

    // Build final workflow
    const workflow: Workflow = {
      id: this.options.workflowId,
      name: this.options.workflowName,
      version: this.options.version,
      format: "graph",
      actions: Array.from(this.actionNodes.values()).map((node) => node.action),
      connections: this.connections,
      metadata: {
        created: new Date().toISOString(),
        description: "Converted from sequential format",
      },
    };

    return {
      workflow,
      stats: { ...this.stats },
      warnings: [...this.warnings],
    };
  }

  /**
   * Process actions recursively, handling control flow
   */
  private processActions(
    actions: Action[],
    depth: number,
    verticalOffset: number,
    parentId?: string
  ): void {
    actions.forEach((action) => {
      const actionId = this.options.preserveActionIds
        ? action.id
        : this.generateId("action");

      // Create action node with temporary position (will be updated in assignPositions)
      const node: ActionNode = {
        action: {
          ...action,
          id: actionId,
          position: [0, 0], // Temporary position
        },
        depth,
        verticalOffset,
        isControlFlow: this.isControlFlowAction(action.type),
        parentId,
      };

      this.actionNodes.set(actionId, node);
      this.stats.actionsConverted++;
      this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);

      // Handle control flow actions
      if (this.isControlFlowAction(action.type)) {
        this.handleControlFlow(action, actionId, depth, verticalOffset);
      }
    });
  }

  /**
   * Build linear connections between sequential actions
   */
  private buildLinearConnections(actions: Action[]): void {
    const actionIds = Array.from(this.actionNodes.keys());

    for (let i = 0; i < actions.length - 1; i++) {
      const currentId = actionIds[i];
      const nextId = actionIds[i + 1];

      if (!currentId || !nextId) continue;

      const currentNode = this.actionNodes.get(currentId);
      if (!currentNode) continue;

      // Skip if this is a control flow action (connections handled separately)
      if (currentNode.isControlFlow) {
        continue;
      }

      // Create connection
      this.addConnection(currentId, nextId, "main", 0, 0);
    }
  }

  /**
   * Handle control flow actions (IF, LOOP, SWITCH, TRY_CATCH)
   */
  private handleControlFlow(
    action: Action,
    actionId: string,
    _depth: number,
    _verticalOffset: number
  ): void {
    this.stats.controlFlowExpanded++;

    switch (action.type) {
      case "IF":
        this.handleIfAction(action as Action<"IF">, actionId);
        break;
      case "LOOP":
        this.handleLoopAction(action as Action<"LOOP">, actionId);
        break;
      case "SWITCH":
        this.handleSwitchAction(action as Action<"SWITCH">, actionId);
        break;
      case "TRY_CATCH":
        this.handleTryCatchAction(action as Action<"TRY_CATCH">, actionId);
        break;
    }
  }

  /**
   * Handle IF action conversion
   *
   * Creates connections for then/else branches:
   * - Output 0 (main[0]): true branch (then actions)
   * - Output 1 (main[1]): false branch (else actions)
   */
  private handleIfAction(action: Action<"IF">, actionId: string): void {
    const config = action.config as IfActionConfig;

    // Process then branch (output 0)
    if (config.thenActions && config.thenActions.length > 0) {
      const thenActionId = config.thenActions[0] || "";
      this.addConnection(actionId, thenActionId, "main", 0, 0);

      // Note: In a full implementation, we would need to resolve action IDs
      // or inline actions. For now, we assume action IDs are provided.
    }

    // Process else branch (output 1)
    if (config.elseActions && config.elseActions.length > 0) {
      const elseActionId = config.elseActions[0] || "";
      this.addConnection(actionId, elseActionId, "main", 1, 0);
    }
  }

  /**
   * Handle LOOP action conversion
   *
   * Creates connections for loop body and exit:
   * - Output 0 (main[0]): loop body (first iteration)
   * - Last action in body connects back to loop start
   * - Exit connection after loop completes
   */
  private handleLoopAction(action: Action<"LOOP">, actionId: string): void {
    const config = action.config as LoopActionConfig;

    // Process loop body
    if (config.actions && config.actions.length > 0) {
      const firstBodyActionId = config.actions[0] || "";
      this.addConnection(actionId, firstBodyActionId, "main", 0, 0);

      // Note: Loop back connection would need to be handled by execution engine
      // as it creates a cycle. For visualization, we show forward flow only.
    }
  }

  /**
   * Handle SWITCH action conversion
   *
   * Creates connections for each case:
   * - Output N (main[N]): case N actions
   * - Last output: default case actions
   */
  private handleSwitchAction(action: Action<"SWITCH">, actionId: string): void {
    const config = action.config as SwitchActionConfig;

    // Process each case
    config.cases.forEach((caseItem, index) => {
      if (caseItem.actions && caseItem.actions.length > 0) {
        const caseActionId = caseItem.actions[0] || "";
        this.addConnection(actionId, caseActionId, "main", index, 0);
      }
    });

    // Process default case
    if (config.defaultActions && config.defaultActions.length > 0) {
      const defaultActionId = config.defaultActions[0] || "";
      const defaultIndex = config.cases.length;
      this.addConnection(actionId, defaultActionId, "main", defaultIndex, 0);
    }
  }

  /**
   * Handle TRY_CATCH action conversion
   *
   * Creates connections for try/catch/finally:
   * - success output: try actions
   * - error output: catch actions
   * - Finally actions connected after both paths
   */
  private handleTryCatchAction(
    action: Action<"TRY_CATCH">,
    actionId: string
  ): void {
    const config = action.config as TryCatchActionConfig;

    // Process try branch (success path)
    if (config.tryActions && config.tryActions.length > 0) {
      const tryActionId = config.tryActions[0] || "";
      this.addConnection(actionId, tryActionId, "success", 0, 0);
    }

    // Process catch branch (error path)
    if (config.catchActions && config.catchActions.length > 0) {
      const catchActionId = config.catchActions[0] || "";
      this.addConnection(actionId, catchActionId, "error", 0, 0);
    }

    // Finally actions would be handled by execution engine
    if (config.finallyActions && config.finallyActions.length > 0) {
      this.warnings.push(
        `Action ${actionId}: Finally actions require special execution handling`
      );
    }
  }

  /**
   * Add a connection between actions
   */
  private addConnection(
    sourceId: string,
    targetId: string,
    type: "main" | "error" | "success" | "parallel",
    outputIndex: number,
    inputIndex: number
  ): void {
    if (!this.connections[sourceId]) {
      this.connections[sourceId] = {};
    }

    const sourceConnections = this.connections[sourceId];
    if (!sourceConnections) {
      return;
    }

    if (!sourceConnections[type as keyof typeof sourceConnections]) {
      (sourceConnections as Record<string, Connection[][]>)[type] = [];
    }

    const outputs = (sourceConnections as Record<string, Connection[][]>)[type];
    if (!outputs) {
      return;
    }

    // Ensure output array exists
    while (outputs.length <= outputIndex) {
      outputs.push([]);
    }

    // Add connection
    if (!outputs[outputIndex]) {
      outputs[outputIndex] = [];
    }
    outputs[outputIndex].push({
      action: targetId,
      type,
      index: inputIndex,
    });

    this.stats.connectionsCreated++;
  }

  /**
   * Assign positions to all actions using auto-layout
   */
  private assignPositions(): void {
    const actions = Array.from(this.actionNodes.values()).map(
      (node) => node.action
    );

    // Use AutoLayout algorithm
    const layout = new AutoLayout({
      horizontalSpacing: this.options.layout.horizontalSpacing,
      verticalSpacing: this.options.layout.verticalSpacing,
      startX: this.options.layout.startX,
      startY: this.options.layout.startY,
    });

    layout.layout(actions, this.connections);

    // Update node positions
    actions.forEach((action) => {
      const node = this.actionNodes.get(action.id);
      if (node) {
        node.action.position = action.position;
      }
    });
  }

  /**
   * Check if action type is control flow
   */
  private isControlFlowAction(type: ActionType): boolean {
    return ["IF", "LOOP", "SWITCH", "TRY_CATCH", "BREAK", "CONTINUE"].includes(
      type
    );
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Extract nested actions from control flow configs
   *
   * Flattens nested action references into a flat list for graph representation.
   *
   * @param action - Control flow action
   * @returns Array of action IDs
   */
  extractNestedActions(action: Action): string[] {
    const actionIds: string[] = [];

    switch (action.type) {
      case "IF": {
        const config = action.config as IfActionConfig;
        if (config.thenActions) actionIds.push(...config.thenActions);
        if (config.elseActions) actionIds.push(...config.elseActions);
        break;
      }
      case "LOOP": {
        const config = action.config as LoopActionConfig;
        if (config.actions) actionIds.push(...config.actions);
        break;
      }
      case "SWITCH": {
        const config = action.config as SwitchActionConfig;
        config.cases.forEach((caseItem) => {
          if (caseItem.actions) actionIds.push(...caseItem.actions);
        });
        if (config.defaultActions) actionIds.push(...config.defaultActions);
        break;
      }
      case "TRY_CATCH": {
        const config = action.config as TryCatchActionConfig;
        if (config.tryActions) actionIds.push(...config.tryActions);
        if (config.catchActions) actionIds.push(...config.catchActions);
        if (config.finallyActions) actionIds.push(...config.finallyActions);
        break;
      }
    }

    return actionIds;
  }
}

/**
 * Convenience function to convert sequential actions to graph workflow
 *
 * @param actions - Sequential action list
 * @param options - Converter options
 * @returns Converted workflow
 *
 * @example
 * const workflow = convertSequentialToGraph([action1, action2, action3], {
 *   workflowName: 'My Workflow',
 *   layout: { horizontalSpacing: 250 }
 * });
 */
export function convertSequentialToGraph(
  actions: Action[],
  options?: ConverterOptions
): Workflow {
  const converter = new SequentialToGraphConverter(options);
  const result = converter.convert(actions);

  // Log warnings if any
  if (result.warnings.length > 0) {
    console.warn("Conversion warnings:", result.warnings);
  }

  return result.workflow;
}
