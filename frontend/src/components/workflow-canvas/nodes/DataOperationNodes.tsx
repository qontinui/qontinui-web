/**
 * Data Operation Node Components
 *
 * Custom nodes for data manipulation actions:
 * - Variable operations: SET_VARIABLE, GET_VARIABLE
 * - Collection operations: FILTER, MAP, REDUCE, SORT
 * - String operations: STRING_OPERATION (substring, concat, replace, etc.)
 * - Math operations: MATH_OPERATION (add, subtract, multiply, etc.)
 */

import React from 'react';
import { NodeProps } from '@xyflow/react';
import { BaseNode, BaseNodeData, CompactNode } from './BaseNode';
import type {
  SetVariableActionConfig,
  GetVariableActionConfig,
  FilterActionConfig,
  MapActionConfig,
  ReduceActionConfig,
  SortActionConfig,
  StringOperationActionConfig,
  MathOperationActionConfig,
} from '@/lib/action-schema/configs/data-actions';

// =============================================================================
// Variable Operation Nodes
// =============================================================================

/**
 * SET_VARIABLE Node
 */
export function SetVariableNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as SetVariableActionConfig;
  const varName = config.variableName || 'variable';
  const scope = config.scope || 'local';

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
export function GetVariableNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as GetVariableActionConfig;
  const varName = config.variableName || 'variable';

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
export function FilterNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as FilterActionConfig;
  const varName = config.variableName || 'array';

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
export function MapNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as MapActionConfig;
  const varName = config.variableName || 'array';

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
export function ReduceNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as ReduceActionConfig;
  const varName = config.variableName || 'array';

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
export function SortNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as SortActionConfig;
  const order = config.order === 'desc' ? 'desc' : 'asc';
  const field = config.sortBy;

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
export function StringOperationNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as StringOperationActionConfig;
  const operation = config.operation || 'concat';

  // Map operation to display name
  const operationNames: Record<string, string> = {
    concat: 'Concatenate',
    substring: 'Substring',
    replace: 'Replace',
    split: 'Split',
    trim: 'Trim',
    uppercase: 'Uppercase',
    lowercase: 'Lowercase',
    match: 'Match Pattern',
    parse_json: 'Parse JSON',
  };

  const displayName = operationNames[operation] || operation;

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
export function MathOperationNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as MathOperationActionConfig;
  const operation = config.operation || 'add';

  // Map operation to symbol
  const operationSymbols: Record<string, string> = {
    add: '+',
    subtract: '-',
    multiply: '×',
    divide: '÷',
    modulo: '%',
    power: '^',
    sqrt: '√',
    abs: '|x|',
    round: '⌊⌉',
    custom: 'ƒ(x)',
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
