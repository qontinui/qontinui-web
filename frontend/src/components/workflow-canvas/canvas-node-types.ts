/**
 * Node and edge type registries for React Flow
 *
 * Maps action types to their visual node components and edge renderers.
 */

import { DefaultNode } from "./nodes/DefaultNode";
import { ControlFlowNodes } from "./nodes/ControlFlowNodes";
import { CodeBlockNode, CustomFunctionNode } from "./nodes/CodeNodes";
import { CustomEdge } from "./CustomEdge";

// ============================================================================
// Node Type Registry
// ============================================================================

export const nodeTypes = {
  // Default for most nodes - categories use DefaultNode
  default: DefaultNode,
  find: DefaultNode,
  mouse: DefaultNode,
  keyboard: DefaultNode,
  control_flow: DefaultNode,
  data: DefaultNode,
  state: DefaultNode,

  // Specific control flow nodes with custom handle IDs
  IF: ControlFlowNodes.IF,
  LOOP: ControlFlowNodes.LOOP,
  SWITCH: ControlFlowNodes.SWITCH,
  TRY_CATCH: ControlFlowNodes.TRY_CATCH,
  BREAK: ControlFlowNodes.BREAK,
  CONTINUE: ControlFlowNodes.CONTINUE,

  // Code execution nodes
  CODE_BLOCK: CodeBlockNode,
  CUSTOM_FUNCTION: CustomFunctionNode,
};

// ============================================================================
// Edge Type Registry
// ============================================================================

export const edgeTypes = {
  custom: CustomEdge,
};
