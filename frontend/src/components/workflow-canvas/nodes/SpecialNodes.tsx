/**
 * Special Node Components
 *
 * Custom nodes for special workflow elements and state actions:
 * - START - Entry point (no input, one output)
 * - END - Exit point (one input, no output)
 * - COMMENT - Annotations (no execution)
 * - GROUP - Visual grouping (container)
 * - MERGE - Merge point indicator
 * - GO_TO_STATE - State transition
 * - RUN_PROCESS - Sub-workflow execution
 */

import React from 'react';
import { NodeProps } from '@xyflow/react';
import { BaseNode, BaseNodeData, TerminalNode } from './BaseNode';
import type {
  GoToStateActionConfig,
  RunProcessActionConfig,
} from '@/lib/action-schema/configs/state-actions';

// =============================================================================
// Workflow Control Nodes (Special)
// =============================================================================

/**
 * START Node - Entry point for workflow
 */
export function StartNode(props: NodeProps<BaseNodeData>) {
  return (
    <TerminalNode
      {...props}
      variant="start"
      className="special-node start-node bg-green-50 border-green-500 border-3"
    />
  );
}

/**
 * END Node - Exit point for workflow
 */
export function EndNode(props: NodeProps<BaseNodeData>) {
  return (
    <TerminalNode
      {...props}
      variant="end"
      className="special-node end-node bg-red-50 border-red-500 border-3"
    />
  );
}

/**
 * COMMENT Node - Annotations and notes
 */
export function CommentNode(props: NodeProps<BaseNodeData>) {
  const { action } = props.data;
  const text = action.name || action.base?.description || 'Comment';

  return (
    <div
      className="
        special-node comment-node
        bg-yellow-50 border-2 border-yellow-300 border-dashed
        rounded-lg p-3
        min-w-[200px] max-w-[300px]
        shadow-sm
      "
      style={{ pointerEvents: 'all' }}
    >
      <div className="flex items-start gap-2">
        <div className="text-yellow-600 flex-shrink-0 mt-0.5">
          <svg
            className="w-4 h-4"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
          </svg>
        </div>
        <div className="flex-1 text-sm text-gray-700 italic">
          {text}
        </div>
      </div>
    </div>
  );
}

/**
 * GROUP Node - Visual grouping container
 */
export function GroupNode(props: NodeProps<BaseNodeData>) {
  const { action } = props.data;
  const groupName = action.name || 'Group';

  return (
    <div
      className="
        special-node group-node
        bg-gray-50/50 border-2 border-gray-300 border-dashed
        rounded-lg p-4
        min-w-[250px]
        backdrop-blur-sm
      "
      style={{ pointerEvents: 'all' }}
    >
      <div className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        {groupName}
      </div>
      <div className="text-xs text-gray-500">
        Drag nodes here to group them
      </div>
    </div>
  );
}

/**
 * MERGE Node - Merge point for multiple branches
 */
export function MergeNode(props: NodeProps<BaseNodeData>) {
  const { action } = props.data;

  return (
    <div
      className="
        special-node merge-node
        bg-white border-2 border-blue-400
        rounded-lg
        w-[160px] h-[60px]
        flex items-center justify-center
        shadow-md
      "
    >
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <svg
            className="w-5 h-5 text-blue-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
            />
          </svg>
        </div>
        <div className="text-xs font-semibold text-blue-700">MERGE</div>
      </div>
    </div>
  );
}

// =============================================================================
// State Action Nodes
// =============================================================================

/**
 * GO_TO_STATE Node - State transition
 */
export function GoToStateNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as GoToStateActionConfig;
  const stateName = config.stateName || 'Unknown State';

  return (
    <div className="relative">
      <BaseNode
        {...props}
        className="state-node go-to-state-node border-indigo-400 bg-indigo-50"
      />

      {/* Show target state as badge */}
      <div className="absolute left-0 bottom-full mb-2 pointer-events-none">
        <div className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded border border-indigo-300">
          → {stateName}
        </div>
      </div>
    </div>
  );
}

/**
 * RUN_PROCESS Node - Execute sub-workflow
 */
export function RunProcessNode(props: NodeProps<BaseNodeData>) {
  const config = props.data.action.config as RunProcessActionConfig;
  const processName = config.processName || 'Sub-workflow';
  const async = config.async || false;

  return (
    <div className="relative">
      <BaseNode
        {...props}
        className="state-node run-process-node border-violet-400 bg-violet-50"
      />

      {/* Show async badge */}
      {async && (
        <div className="absolute right-2 top-2 pointer-events-none">
          <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-xs rounded-full border border-violet-300">
            async
          </span>
        </div>
      )}

      {/* Show process name */}
      <div className="absolute left-0 bottom-full mb-2 pointer-events-none">
        <div className="text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded border border-violet-300 max-w-[200px] truncate">
          {processName}
        </div>
      </div>
    </div>
  );
}

/**
 * Export all special nodes
 */
export const SpecialNodes = {
  // Workflow control
  START: StartNode,
  END: EndNode,
  COMMENT: CommentNode,
  GROUP: GroupNode,
  MERGE: MergeNode,

  // State actions
  GO_TO_STATE: GoToStateNode,
  RUN_PROCESS: RunProcessNode,
};
