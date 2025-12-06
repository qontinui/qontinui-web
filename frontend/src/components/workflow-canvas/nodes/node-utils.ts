/**
 * Node Utilities
 *
 * Helper functions for node components:
 * - Generate node summaries
 * - Determine node dimensions
 * - Calculate output counts
 * - Get handle positions
 * - Validate node configurations
 */

import {
  Action,
  ActionType,
  getActionOutputCount,
} from "@/lib/action-schema/action-types";
import type {
  ClickActionConfig,
  DoubleClickActionConfig,
  RightClickActionConfig,
  TypeActionConfig,
  WaitActionConfig,
} from "@/lib/action-schema/configs/mouse-actions";
import type {
  IfActionConfig,
  LoopActionConfig,
  SwitchActionConfig,
} from "@/lib/action-schema/configs/control-flow-actions";
import type {
  SetVariableActionConfig,
  GetVariableActionConfig,
  FilterActionConfig,
  MapActionConfig,
  SortActionConfig,
} from "@/lib/action-schema/configs/data-actions";
import type {
  CodeBlockActionConfig,
  CustomFunctionActionConfig,
} from "@/lib/action-schema/configs/code-actions";

/**
 * Node categories for styling and organization
 */
export type NodeCategory =
  | "find"
  | "mouse"
  | "keyboard"
  | "controlFlow"
  | "data"
  | "state"
  | "code"
  | "special";

/**
 * Get category for action type
 */
export function getNodeCategory(actionType: ActionType): NodeCategory {
  // Find actions
  if (
    ["FIND", "FIND_STATE_IMAGE", "VANISH", "EXISTS", "WAIT"].includes(
      actionType
    )
  ) {
    return "find";
  }

  // Mouse actions
  if (
    [
      "CLICK",
      "DOUBLE_CLICK",
      "RIGHT_CLICK",
      "MOUSE_MOVE",
      "MOUSE_DOWN",
      "MOUSE_UP",
      "DRAG",
      "SCROLL",
    ].includes(actionType)
  ) {
    return "mouse";
  }

  // Keyboard actions
  if (
    ["TYPE", "KEY_PRESS", "KEY_DOWN", "KEY_UP", "HOTKEY"].includes(actionType)
  ) {
    return "keyboard";
  }

  // Control flow actions
  if (
    ["IF", "LOOP", "BREAK", "CONTINUE", "SWITCH", "TRY_CATCH"].includes(
      actionType
    )
  ) {
    return "controlFlow";
  }

  // Data actions
  if (
    [
      "SET_VARIABLE",
      "GET_VARIABLE",
      "SORT",
      "FILTER",
      "MAP",
      "REDUCE",
      "STRING_OPERATION",
      "MATH_OPERATION",
    ].includes(actionType)
  ) {
    return "data";
  }

  // State actions
  if (["GO_TO_STATE", "RUN_WORKFLOW", "SCREENSHOT"].includes(actionType)) {
    return "state";
  }

  // Code actions
  if (["CODE_BLOCK", "CUSTOM_FUNCTION"].includes(actionType)) {
    return "code";
  }

  return "special";
}

/**
 * Get color scheme for category
 */
export function getCategoryColor(category: NodeCategory): string {
  const colors: Record<NodeCategory, string> = {
    find: "category-find",
    mouse: "category-mouse",
    keyboard: "category-keyboard",
    controlFlow: "category-control-flow",
    data: "category-data",
    state: "category-state",
    code: "category-code",
    special: "category-special",
  };
  return colors[category];
}

/**
 * Generate human-readable summary for a node
 */
export function getNodeSummary(action: Action): string {
  const { type, config } = action;

  switch (type) {
    // Find Actions
    case "FIND":
      return "Find element on screen";

    case "FIND_STATE_IMAGE":
      return "Find state image";

    case "VANISH":
      return "Wait for element to vanish";

    case "EXISTS":
      return "Check if element exists";

    case "WAIT":
      const waitConfig = config as WaitActionConfig;
      return `Wait ${waitConfig.duration || 1000}ms`;

    // Mouse Actions
    case "CLICK":
      const clickConfig = config as ClickActionConfig;
      if (
        !clickConfig.target ||
        clickConfig.target === "Current Position"
      ) {
        return "Click at current position";
      }
      return `Click ${clickConfig.target}`;

    case "DOUBLE_CLICK":
      const doubleClickConfig = config as DoubleClickActionConfig;
      if (
        !doubleClickConfig.target ||
        doubleClickConfig.target.type === "currentPosition"
      ) {
        return "Double click at current position";
      }
      return "Double click element";

    case "RIGHT_CLICK":
      const rightClickConfig = config as RightClickActionConfig;
      if (
        !rightClickConfig.target ||
        rightClickConfig.target.type === "currentPosition"
      ) {
        return "Right click at current position";
      }
      return "Right click element";

    case "MOUSE_MOVE":
      return "Move mouse";

    case "MOUSE_DOWN":
      return "Press mouse button";

    case "MOUSE_UP":
      return "Release mouse button";

    case "DRAG":
      return "Drag and drop";

    case "SCROLL":
      return "Scroll window";

    // Keyboard Actions
    case "TYPE":
      const typeConfig = config as TypeActionConfig;
      const text = typeConfig.text || "";
      const preview = text.length > 20 ? `${text.substring(0, 20)}...` : text;
      return preview ? `Type "${preview}"` : "Type text";

    case "KEY_PRESS":
      return "Press key";

    case "KEY_DOWN":
      return "Key down";

    case "KEY_UP":
      return "Key up";

    case "HOTKEY":
      return "Press hotkey";

    // Control Flow Actions
    case "IF":
      const ifConfig = config as IfActionConfig;
      const conditionType = ifConfig.condition?.type || "expression";
      return `If (${conditionType})`;

    case "LOOP":
      const loopConfig = config as LoopActionConfig;
      const loopType = loopConfig.loopType || "FOR";
      if (loopType === "FOR" && loopConfig.iterations) {
        return `Loop ${loopConfig.iterations} times`;
      }
      return `${loopType} loop`;

    case "BREAK":
      return "Break loop";

    case "CONTINUE":
      return "Continue to next iteration";

    case "SWITCH":
      const switchConfig = config as SwitchActionConfig;
      const caseCount = switchConfig.cases?.length || 0;
      return `Switch (${caseCount} cases)`;

    case "TRY_CATCH":
      return "Try/Catch error handling";

    // Data Actions
    case "SET_VARIABLE":
      const setVarConfig = config as SetVariableActionConfig;
      return `Set ${setVarConfig.variableName || "variable"}`;

    case "GET_VARIABLE":
      const getVarConfig = config as GetVariableActionConfig;
      return `Get ${getVarConfig.variableName || "variable"}`;

    case "SORT":
      const sortConfig = config as SortActionConfig;
      return `Sort ${sortConfig.order === "desc" ? "descending" : "ascending"}`;

    case "FILTER":
      const filterConfig = config as FilterActionConfig;
      return `Filter ${filterConfig.variableName || "array"}`;

    case "MAP":
      const mapConfig = config as MapActionConfig;
      return `Map ${mapConfig.variableName || "array"}`;

    case "REDUCE":
      return "Reduce array";

    case "STRING_OPERATION":
      return "String operation";

    case "MATH_OPERATION":
      return "Math operation";

    // State Actions
    case "GO_TO_STATE":
      return "Go to state";

    case "RUN_WORKFLOW":
      return "Run workflow";

    case "SCREENSHOT":
      return "Take screenshot";

    // Code Actions
    case "CODE_BLOCK":
      const codeBlockConfig = config as CodeBlockActionConfig;
      const codePreview = codeBlockConfig.code
        ? codeBlockConfig.code.split("\n")[0].substring(0, 30) + "..."
        : "Python code";
      return codePreview;

    case "CUSTOM_FUNCTION":
      const customFunctionConfig = config as CustomFunctionActionConfig;
      return `Function: ${customFunctionConfig.functionName || "unnamed"}`;

    default:
      return (type as string).replace(/_/g, " ").toLowerCase();
  }
}

/**
 * Get number of outputs for an action
 */
export function getOutputCount(action: Action): number {
  return getActionOutputCount(action.type, action.config);
}

/**
 * Get output handle IDs for an action
 */
export function getOutputHandleIds(action: Action): string[] {
  const { type, config } = action;

  switch (type) {
    case "IF":
      return ["true", "false"];

    case "LOOP":
      return ["loop", "main"];

    case "TRY_CATCH":
      return ["main", "error"];

    case "SWITCH":
      const switchConfig = config as SwitchActionConfig;
      const cases = switchConfig.cases || [];
      const handles = cases.map((_, i) => `case_${i}`);
      handles.push("default");
      return handles;

    case "BREAK":
    case "CONTINUE":
      return []; // No outputs

    default:
      return ["main"];
  }
}

/**
 * Node dimension presets
 */
export interface NodeDimensions {
  width: number;
  height: number;
}

/**
 * Get recommended dimensions for action type
 */
export function getNodeDimensions(action: Action): NodeDimensions {
  const { type, config } = action;

  // Larger nodes for complex actions
  if (type === "SWITCH") {
    const switchConfig = config as SwitchActionConfig;
    const cases = switchConfig.cases?.length || 0;
    return {
      width: 220,
      height: Math.max(100, 60 + cases * 30),
    };
  }

  if (type === "LOOP") {
    return { width: 200, height: 90 };
  }

  if (type === "IF" || type === "TRY_CATCH") {
    return { width: 200, height: 85 };
  }

  // Compact nodes for simple actions
  if (["BREAK", "CONTINUE", "WAIT"].includes(type)) {
    return { width: 160, height: 70 };
  }

  // Default size
  return { width: 180, height: 80 };
}

/**
 * Calculate handle positions for multiple outputs
 */
export function getHandlePositions(
  outputCount: number
): Array<{ top: string }> {
  if (outputCount === 0) return [];
  if (outputCount === 1) return [{ top: "50%" }];

  const positions: Array<{ top: string }> = [];
  const spacing = 100 / (outputCount + 1);

  for (let i = 0; i < outputCount; i++) {
    const topPercent = spacing * (i + 1);
    positions.push({ top: `${topPercent}%` });
  }

  return positions;
}

/**
 * Validate node configuration
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateNodeConfig(action: Action): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic validation
  if (!action.id) {
    errors.push("Missing action ID");
  }

  if (!action.type) {
    errors.push("Missing action type");
  }

  if (!action.config) {
    errors.push("Missing action configuration");
  }

  // Type-specific validation
  switch (action.type) {
    case "CLICK":
    case "DOUBLE_CLICK":
    case "RIGHT_CLICK":
      // Target is optional - defaults to current position (pure action)
      // No validation error needed
      break;

    case "TYPE":
      const typeConfig = action.config as TypeActionConfig;
      if (!typeConfig.text && !typeConfig.variable) {
        warnings.push("No text or variable specified for TYPE action");
      }
      break;

    case "IF":
      const ifConfig = action.config as IfActionConfig;
      if (!ifConfig.condition) {
        errors.push("Missing IF condition");
      }
      if (!ifConfig.thenActions || ifConfig.thenActions.length === 0) {
        warnings.push("IF action has no then-actions");
      }
      break;

    case "LOOP":
      const loopConfig = action.config as LoopActionConfig;
      if (!loopConfig.loopType) {
        errors.push("Missing loop type");
      }
      if (loopConfig.loopType === "FOR" && !loopConfig.iterations) {
        errors.push("FOR loop missing iterations count");
      }
      if (loopConfig.loopType === "WHILE" && !loopConfig.condition) {
        errors.push("WHILE loop missing condition");
      }
      if (!loopConfig.actions || loopConfig.actions.length === 0) {
        warnings.push("LOOP has no actions");
      }
      break;

    case "SWITCH":
      const switchConfig = action.config as SwitchActionConfig;
      if (!switchConfig.expression) {
        errors.push("Missing SWITCH expression");
      }
      if (!switchConfig.cases || switchConfig.cases.length === 0) {
        warnings.push("SWITCH has no cases");
      }
      break;

    case "SET_VARIABLE":
      const setVarConfig = action.config as SetVariableActionConfig;
      if (!setVarConfig.variableName) {
        errors.push("Missing variable name for SET_VARIABLE");
      }
      break;

    case "GET_VARIABLE":
      const getVarConfig = action.config as GetVariableActionConfig;
      if (!getVarConfig.variableName) {
        errors.push("Missing variable name for GET_VARIABLE");
      }
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if node is a terminal node (no outputs)
 */
export function isTerminalNode(actionType: ActionType): boolean {
  return actionType === "BREAK" || actionType === "CONTINUE";
}

/**
 * Check if node is a branching node (multiple outputs)
 */
export function isBranchingNode(actionType: ActionType): boolean {
  return ["IF", "LOOP", "SWITCH", "TRY_CATCH"].includes(actionType);
}

/**
 * Get display name for action type
 */
export function getActionTypeDisplayName(actionType: ActionType): string {
  const displayNames: Partial<Record<ActionType, string>> = {
    FIND_STATE_IMAGE: "Find State Image",
    MOUSE_MOVE: "Mouse Move",
    MOUSE_DOWN: "Mouse Down",
    MOUSE_UP: "Mouse Up",
    KEY_PRESS: "Key Press",
    KEY_DOWN: "Key Down",
    KEY_UP: "Key Up",
    TRY_CATCH: "Try/Catch",
    SET_VARIABLE: "Set Variable",
    GET_VARIABLE: "Get Variable",
    STRING_OPERATION: "String Operation",
    MATH_OPERATION: "Math Operation",
    GO_TO_STATE: "Go To State",
    RUN_WORKFLOW: "Run Workflow",
    CODE_BLOCK: "Code Block",
    CUSTOM_FUNCTION: "Custom Function",
  };

  return displayNames[actionType] || actionType.replace(/_/g, " ");
}

/**
 * Estimate node execution time (for UI hints)
 */
export function estimateExecutionTime(action: Action): number {
  const { type, config } = action;

  switch (type) {
    case "WAIT":
      const waitConfig = config as WaitActionConfig;
      return waitConfig.duration || 1000;

    case "LOOP":
      const loopConfig = config as LoopActionConfig;
      if (loopConfig.loopType === "FOR" && loopConfig.iterations) {
        return loopConfig.iterations * 100; // Rough estimate
      }
      return 1000;

    case "FIND":
    case "VANISH":
    case "EXISTS":
      return 2000; // Image matching can take time

    case "CODE_BLOCK":
    case "CUSTOM_FUNCTION":
      const codeConfig = config as CodeBlockActionConfig;
      return codeConfig.timeout || 30000; // Default 30s timeout

    default:
      return 100; // Most actions are fast
  }
}
