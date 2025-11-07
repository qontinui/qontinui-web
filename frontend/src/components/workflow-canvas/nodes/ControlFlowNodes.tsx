/**
 * Control Flow Node Components
 *
 * Custom nodes for control flow actions:
 * - IF - Conditional branching (2 outputs: true/false)
 * - LOOP - Iteration (2 outputs: loop/main)
 * - SWITCH - Multi-way branching (N outputs: case_0, case_1, ..., default)
 * - BREAK - Exit loop (no outputs)
 * - CONTINUE - Skip to next iteration (no outputs)
 * - TRY_CATCH - Error handling (2 outputs: main/error)
 */

import React from 'react';
import { NodeProps } from '@xyflow/react';
import { Action } from '@/lib/action-schema/action-types';
import { BaseNode, BaseNodeData, MultiOutputNode } from './BaseNode';
import { MultiOutputHandles, getSwitchOutputHandles } from './handles';
import type {
  IfActionConfig,
  LoopActionConfig,
  SwitchActionConfig,
  BreakActionConfig,
  ContinueActionConfig,
  TryCatchActionConfig,
} from '@/lib/action-schema/configs/control-flow-actions';

/**
 * IF Node - Conditional execution with true/false branches
 */
export function IfNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as IfActionConfig;
  const conditionType = config.condition?.type || 'expression';
  const expression = config.condition?.expression || '';

  const outputLabels = [
    { id: 'main-0', label: 'True', color: 'bg-green-500 text-white' },
    { id: 'main-1', label: 'False', color: 'bg-red-500 text-white' },
  ];

  return (
    <MultiOutputNode
      {...props}
      outputLabels={outputLabels}
      className="control-flow-node if-node border-blue-400"
    />
  );
}

/**
 * LOOP Node - Iteration with loop/exit branches
 */
export function LoopNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as LoopActionConfig;
  const loopType = config.loopType || 'FOR';
  const iterations = config.iterations;
  const iteratorVar = config.iteratorVariable || 'i';

  const outputLabels = [
    { id: 'main-0', label: 'Loop', color: 'bg-blue-500 text-white' },
    { id: 'main-1', label: 'Exit', color: 'bg-gray-500 text-white' },
  ];

  return (
    <MultiOutputNode
      {...props}
      outputLabels={outputLabels}
      className="control-flow-node loop-node border-purple-400"
    />
  );
}

/**
 * SWITCH Node - Multi-way conditional branching
 */
export function SwitchNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as SwitchActionConfig;
  const cases = config.cases || [];
  const expression = config.expression || 'value';

  // Generate output handles for each case + default
  const outputConfigs = getSwitchOutputHandles(cases.length);

  const outputLabels = outputConfigs.map((output) => ({
    id: output.id,
    label: output.label,
    color: output.id === 'default' ? 'bg-gray-500 text-white' : 'bg-blue-500 text-white',
  }));

  return (
    <div className="relative">
      <MultiOutputNode
        {...props}
        outputLabels={outputLabels}
        className="control-flow-node switch-node border-indigo-400"
      />

      {/* Show case values as tooltips/hints */}
      <div className="absolute left-0 bottom-full mb-2 pointer-events-none">
        <div className="text-xs text-gray-500 bg-white px-2 py-1 rounded shadow-sm border border-gray-200">
          {cases.length} case{cases.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}

/**
 * BREAK Node - Exit from loop (no outputs)
 */
export function BreakNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as BreakActionConfig;
  const hasCondition = !!config.condition;

  return (
    <BaseNode
      {...props}
      showOutputHandle={false}
      className="control-flow-node break-node border-red-400 bg-red-50"
    />
  );
}

/**
 * CONTINUE Node - Skip to next iteration (no outputs)
 */
export function ContinueNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as ContinueActionConfig;
  const hasCondition = !!config.condition;

  return (
    <BaseNode
      {...props}
      showOutputHandle={false}
      className="control-flow-node continue-node border-orange-400 bg-orange-50"
    />
  );
}

/**
 * TRY_CATCH Node - Error handling with success/error branches
 */
export function TryCatchNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as TryCatchActionConfig;
  const errorVariable = config.errorVariable;
  const hasCatch = config.catchActions && config.catchActions.length > 0;
  const hasFinally = config.finallyActions && config.finallyActions.length > 0;

  const outputLabels = [
    { id: 'main-0', label: 'Success', color: 'bg-green-500 text-white' },
    { id: 'error-0', label: 'Error', color: 'bg-red-500 text-white' },
  ];

  return (
    <div className="relative">
      <MultiOutputNode
        {...props}
        outputLabels={outputLabels}
        className="control-flow-node try-catch-node border-yellow-400"
      />

      {/* Badges for catch/finally */}
      {(hasCatch || hasFinally) && (
        <div className="absolute left-0 bottom-full mb-2 flex gap-1 pointer-events-none">
          {hasCatch && (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full border border-red-200">
              catch
            </span>
          )}
          {hasFinally && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full border border-blue-200">
              finally
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Export all control flow nodes
 */
export const ControlFlowNodes = {
  IF: IfNode,
  LOOP: LoopNode,
  SWITCH: SwitchNode,
  BREAK: BreakNode,
  CONTINUE: ContinueNode,
  TRY_CATCH: TryCatchNode,
};
