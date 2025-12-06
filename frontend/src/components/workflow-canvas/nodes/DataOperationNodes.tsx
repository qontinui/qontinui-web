/**
 * Data Operation Node Components
 *
 * Custom nodes for data manipulation actions:
 * - Variable operations: SET_VARIABLE, GET_VARIABLE
 * - Collection operations: FILTER, MAP, REDUCE, SORT
 * - String operations: STRING_OPERATION (substring, concat, replace, etc.)
 * - Math operations: MATH_OPERATION (add, subtract, multiply, etc.)
 */

import React from "react";
import { NodeProps, Node as ReactFlowNode } from "@xyflow/react";
import { BaseNode, BaseNodeData, CompactNode } from "./BaseNode";

// =============================================================================
// Variable Operation Nodes
// =============================================================================

/**
 * SET_VARIABLE Node
 */
export function SetVariableNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <BaseNode
      {...props}
      className="data-node variable-node set-variable-node border-orange-400"
    />
  );
}

/**
 * GET_VARIABLE Node
 */
export function GetVariableNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <CompactNode
      {...props}
      className="data-node variable-node get-variable-node border-orange-300"
    />
  );
}

// =============================================================================
// Collection Operation Nodes
// =============================================================================

/**
 * FILTER Node
 */
export function FilterNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <BaseNode
      {...props}
      className="data-node collection-node filter-node border-purple-400"
    />
  );
}

/**
 * MAP Node
 */
export function MapNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <BaseNode
      {...props}
      className="data-node collection-node map-node border-purple-400"
    />
  );
}

/**
 * REDUCE Node
 */
export function ReduceNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <BaseNode
      {...props}
      className="data-node collection-node reduce-node border-purple-400"
    />
  );
}

/**
 * SORT Node
 */
export function SortNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <BaseNode
      {...props}
      className="data-node collection-node sort-node border-purple-400"
    />
  );
}

// =============================================================================
// String Operation Nodes
// =============================================================================

/**
 * STRING_OPERATION Node
 */
export function StringOperationNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  return (
    <BaseNode
      {...props}
      className="data-node string-node string-operation-node border-pink-400"
    />
  );
}

// =============================================================================
// Math Operation Nodes
// =============================================================================

/**
 * MATH_OPERATION Node
 */
export function MathOperationNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  const config = props.data.action.config as MathOperationActionConfig;
  const operation = config.operation || "add";

  // Map operation to symbol
  const operationSymbols: Record<string, string> = {
    add: "+",
    subtract: "-",
    multiply: "×",
    divide: "÷",
    modulo: "%",
    power: "^",
    sqrt: "√",
    abs: "|x|",
    round: "⌊⌉",
    custom: "ƒ(x)",
  };

  const symbol = operationSymbols[operation] || operation;

  return (
    <div className="relative">
      <BaseNode
        {...props}
        className="data-node math-node math-operation-node border-teal-400"
      />

      {/* Show operation symbol as badge */}
      <div className="absolute right-2 top-2 pointer-events-none">
        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-mono rounded border border-teal-300">
          {symbol}
        </span>
      </div>
    </div>
  );
}

/**
 * Export all data operation nodes
 */
export const DataOperationNodes = {
  // Variable operations
  SET_VARIABLE: SetVariableNode,
  GET_VARIABLE: GetVariableNode,

  // Collection operations
  FILTER: FilterNode,
  MAP: MapNode,
  REDUCE: ReduceNode,
  SORT: SortNode,

  // String operations
  STRING_OPERATION: StringOperationNode,

  // Math operations
  MATH_OPERATION: MathOperationNode,
};
