/**
 * Node Registry
 *
 * Central registry mapping action types to their React Flow node components.
 * This is used by React Flow to render the correct component for each node type.
 */

import { ComponentType } from "react";
import { NodeProps, Node as ReactFlowNode } from "@xyflow/react";
import { ActionType } from "@/lib/action-schema/action-types";
import { BaseNodeData } from "./BaseNode";

// Import all node components
import { ControlFlowNodes } from "./ControlFlowNodes";
import { GuiActionNodes } from "./GuiActionNodes";
import { DataOperationNodes } from "./DataOperationNodes";
import { SpecialNodes } from "./SpecialNodes";
import { CodeBlockNode, CustomFunctionNode } from "./CodeNodes";

/**
 * Node component type
 */
export type NodeComponent = ComponentType<
  NodeProps<ReactFlowNode<BaseNodeData>>
>;

/**
 * Complete registry of all node types
 *
 * Maps ActionType to React component
 */
export const NODE_TYPES: Record<ActionType, NodeComponent> = {
  // Find Actions
  FIND: GuiActionNodes.FIND,
  VANISH: GuiActionNodes.VANISH,
  EXISTS: GuiActionNodes.EXISTS,
  WAIT: GuiActionNodes.WAIT,
  RAG_FIND: GuiActionNodes.FIND, // Reuse FIND node for RAG_FIND

  // Mouse Actions
  CLICK: GuiActionNodes.CLICK,
  MOUSE_MOVE: GuiActionNodes.MOUSE_MOVE,
  MOUSE_DOWN: GuiActionNodes.MOUSE_DOWN,
  MOUSE_UP: GuiActionNodes.MOUSE_UP,
  DRAG: GuiActionNodes.DRAG,
  SCROLL: GuiActionNodes.SCROLL,

  // Keyboard Actions
  TYPE: GuiActionNodes.TYPE,
  KEY_PRESS: GuiActionNodes.KEY_PRESS,
  KEY_DOWN: GuiActionNodes.KEY_DOWN,
  KEY_UP: GuiActionNodes.KEY_UP,
  HOTKEY: GuiActionNodes.HOTKEY,

  // Control Flow Actions
  IF: ControlFlowNodes.IF,
  LOOP: ControlFlowNodes.LOOP,
  BREAK: ControlFlowNodes.BREAK,
  CONTINUE: ControlFlowNodes.CONTINUE,
  SWITCH: ControlFlowNodes.SWITCH,
  TRY_CATCH: ControlFlowNodes.TRY_CATCH,

  // Data Actions
  SET_VARIABLE: DataOperationNodes.SET_VARIABLE,
  GET_VARIABLE: DataOperationNodes.GET_VARIABLE,
  SORT: DataOperationNodes.SORT,
  FILTER: DataOperationNodes.FILTER,
  MAP: DataOperationNodes.MAP,
  REDUCE: DataOperationNodes.REDUCE,
  STRING_OPERATION: DataOperationNodes.STRING_OPERATION,
  MATH_OPERATION: DataOperationNodes.MATH_OPERATION,

  // State Actions
  GO_TO_STATE: SpecialNodes.GO_TO_STATE,
  RUN_WORKFLOW: SpecialNodes.RUN_WORKFLOW,
  SCREENSHOT: GuiActionNodes.SCREENSHOT,

  // Code Actions
  CODE_BLOCK: CodeBlockNode,
  CUSTOM_FUNCTION: CustomFunctionNode,

  // Shell Actions
  SHELL: DataOperationNodes.SET_VARIABLE, // Reuse data node styling for shell
  SHELL_SCRIPT: DataOperationNodes.SET_VARIABLE, // Reuse data node styling for shell script
  TRIGGER_AI_ANALYSIS: DataOperationNodes.SET_VARIABLE, // Reuse data node styling for AI analysis
};

/**
 * Get node component for action type
 */
export function getNodeComponent(actionType: ActionType): NodeComponent {
  const component = NODE_TYPES[actionType];
  if (!component) {
    console.warn(`No node component found for action type: ${actionType}`);
    // Return a default component or throw error
    throw new Error(
      `No node component registered for action type: ${actionType}`
    );
  }
  return component;
}

/**
 * Register a custom node type
 * Useful for plugins or custom action types
 */
export function registerNodeType(
  actionType: ActionType,
  component: NodeComponent
): void {
  if (NODE_TYPES[actionType]) {
    console.warn(`Overwriting existing node component for: ${actionType}`);
  }
  (NODE_TYPES as unknown)[actionType] = component;
}

/**
 * Check if node type is registered
 */
export function isNodeTypeRegistered(actionType: ActionType): boolean {
  return actionType in NODE_TYPES;
}

/**
 * Get all registered node types
 */
export function getRegisteredNodeTypes(): ActionType[] {
  return Object.keys(NODE_TYPES) as ActionType[];
}

/**
 * Node type groups for UI organization
 */
export const NODE_TYPE_GROUPS = {
  find: ["FIND", "VANISH", "EXISTS", "WAIT"] as ActionType[],
  mouse: [
    "CLICK",
    "DOUBLE_CLICK",
    "RIGHT_CLICK",
    "MOUSE_MOVE",
    "MOUSE_DOWN",
    "MOUSE_UP",
    "DRAG",
    "SCROLL",
  ] as ActionType[],
  keyboard: [
    "TYPE",
    "KEY_PRESS",
    "KEY_DOWN",
    "KEY_UP",
    "HOTKEY",
  ] as ActionType[],
  controlFlow: [
    "IF",
    "LOOP",
    "BREAK",
    "CONTINUE",
    "SWITCH",
    "TRY_CATCH",
  ] as ActionType[],
  data: [
    "SET_VARIABLE",
    "GET_VARIABLE",
    "SORT",
    "FILTER",
    "MAP",
    "REDUCE",
    "STRING_OPERATION",
    "MATH_OPERATION",
  ] as ActionType[],
  state: ["GO_TO_STATE", "RUN_WORKFLOW", "SCREENSHOT"] as ActionType[],
};

/**
 * Get node types by category
 */
export function getNodeTypesByCategory(
  category: keyof typeof NODE_TYPE_GROUPS
): ActionType[] {
  return NODE_TYPE_GROUPS[category] || [];
}

/**
 * Node metadata for UI purposes
 */
export interface NodeMetadata {
  displayName: string;
  description: string;
  category: keyof typeof NODE_TYPE_GROUPS;
  color: string;
  icon: string;
}

/**
 * Metadata for each node type
 */
export const NODE_METADATA: Partial<Record<ActionType, NodeMetadata>> = {
  // Find Actions
  FIND: {
    displayName: "Find",
    description: "Find element on screen using image matching",
    category: "find",
    color: "amber",
    icon: "search",
  },
  CLICK: {
    displayName: "Click",
    description: "Click on an element",
    category: "mouse",
    color: "green",
    icon: "mouse-pointer-click",
  },
  TYPE: {
    displayName: "Type",
    description: "Type text into an element",
    category: "keyboard",
    color: "cyan",
    icon: "type",
  },
  IF: {
    displayName: "If",
    description: "Conditional branching based on condition",
    category: "controlFlow",
    color: "blue",
    icon: "git-branch",
  },
  LOOP: {
    displayName: "Loop",
    description: "Repeat actions multiple times",
    category: "controlFlow",
    color: "purple",
    icon: "repeat",
  },
  SET_VARIABLE: {
    displayName: "Set Variable",
    description: "Store a value in a variable",
    category: "data",
    color: "orange",
    icon: "variable",
  },
  // Add more metadata as needed
};

/**
 * Get metadata for node type
 */
export function getNodeMetadata(actionType: ActionType): NodeMetadata | null {
  return NODE_METADATA[actionType] || null;
}

/**
 * Default export for React Flow nodeTypes prop
 */
export default NODE_TYPES;
