/**
 * Action and Workflow type system - Graph format only
 *
 * Clean, modern type definitions focused on graph-based workflow execution.
 * All workflows use connections and positions. No backward compatibility cruft.
 */

import { BaseActionSettings, ExecutionSettings } from "./shared/timing-config";
import type {
  WorkflowExpectations,
  ActionExpectations,
} from "@/lib/expectations/types";

// Import all action configs
import {
  FindActionConfig,
  VanishActionConfig,
  ExistsActionConfig,
  WaitActionConfig,
  RagFindActionConfig,
} from "./configs/find-actions";

import {
  ClickActionConfig,
  MouseMoveActionConfig,
  MouseDownActionConfig,
  MouseUpActionConfig,
  DragActionConfig,
  ScrollActionConfig,
} from "./configs/mouse-actions";

import {
  TypeActionConfig,
  KeyPressActionConfig,
  KeyDownActionConfig,
  KeyUpActionConfig,
  HotkeyActionConfig,
} from "./configs/keyboard-actions";

import {
  IfActionConfig,
  LoopActionConfig,
  BreakActionConfig,
  ContinueActionConfig,
  SwitchActionConfig,
  TryCatchActionConfig,
} from "./configs/control-flow-actions";

import {
  SetVariableActionConfig,
  GetVariableActionConfig,
  SortActionConfig,
  FilterActionConfig,
  MapActionConfig,
  ReduceActionConfig,
  StringOperationActionConfig,
  MathOperationActionConfig,
} from "./configs/data-actions";

import {
  GoToStateActionConfig,
  RunWorkflowActionConfig,
  ScreenshotActionConfig,
} from "./configs/state-actions";

import {
  CodeBlockActionConfig,
  CustomFunctionActionConfig,
} from "./configs/code-actions";

import { ShellActionConfig, ShellScriptActionConfig } from "./configs/shell-actions";

import {
  AIPromptActionConfig,
  RunPromptSequenceActionConfig,
} from "./configs/ai-actions";

// ============================================================================
// Action Types
// ============================================================================

export type FindActionType = "FIND" | "VANISH" | "EXISTS" | "WAIT" | "RAG_FIND";

export type MouseActionType =
  | "CLICK"
  | "MOUSE_MOVE"
  | "MOUSE_DOWN"
  | "MOUSE_UP"
  | "DRAG"
  | "SCROLL";

export type KeyboardActionType =
  | "TYPE"
  | "KEY_PRESS"
  | "KEY_DOWN"
  | "KEY_UP"
  | "HOTKEY";

export type ControlFlowActionType =
  | "IF"
  | "LOOP"
  | "BREAK"
  | "CONTINUE"
  | "SWITCH"
  | "TRY_CATCH";

export type DataActionType =
  | "SET_VARIABLE"
  | "GET_VARIABLE"
  | "SORT"
  | "FILTER"
  | "MAP"
  | "REDUCE"
  | "STRING_OPERATION"
  | "MATH_OPERATION";

export type StateActionType = "GO_TO_STATE" | "RUN_WORKFLOW" | "SCREENSHOT";

export type CodeActionType = "CODE_BLOCK" | "CUSTOM_FUNCTION";

export type ShellActionType = "SHELL" | "SHELL_SCRIPT";

export type AIActionType = "AI_PROMPT" | "RUN_PROMPT_SEQUENCE";

export type ActionType =
  | FindActionType
  | MouseActionType
  | KeyboardActionType
  | ControlFlowActionType
  | DataActionType
  | StateActionType
  | CodeActionType
  | ShellActionType
  | AIActionType;

// ============================================================================
// Action Configuration Map
// ============================================================================

export interface ActionConfigMap {
  // Find actions
  FIND: FindActionConfig;
  VANISH: VanishActionConfig;
  EXISTS: ExistsActionConfig;
  WAIT: WaitActionConfig;
  RAG_FIND: RagFindActionConfig;

  // Mouse actions
  CLICK: ClickActionConfig;
  MOUSE_MOVE: MouseMoveActionConfig;
  MOUSE_DOWN: MouseDownActionConfig;
  MOUSE_UP: MouseUpActionConfig;
  DRAG: DragActionConfig;
  SCROLL: ScrollActionConfig;

  // Keyboard actions
  TYPE: TypeActionConfig;
  KEY_PRESS: KeyPressActionConfig;
  KEY_DOWN: KeyDownActionConfig;
  KEY_UP: KeyUpActionConfig;
  HOTKEY: HotkeyActionConfig;

  // Control flow actions
  IF: IfActionConfig;
  LOOP: LoopActionConfig;
  BREAK: BreakActionConfig;
  CONTINUE: ContinueActionConfig;
  SWITCH: SwitchActionConfig;
  TRY_CATCH: TryCatchActionConfig;

  // Data actions
  SET_VARIABLE: SetVariableActionConfig;
  GET_VARIABLE: GetVariableActionConfig;
  SORT: SortActionConfig;
  FILTER: FilterActionConfig;
  MAP: MapActionConfig;
  REDUCE: ReduceActionConfig;
  STRING_OPERATION: StringOperationActionConfig;
  MATH_OPERATION: MathOperationActionConfig;

  // State actions
  GO_TO_STATE: GoToStateActionConfig;
  RUN_WORKFLOW: RunWorkflowActionConfig;
  SCREENSHOT: ScreenshotActionConfig;

  // Code actions
  CODE_BLOCK: CodeBlockActionConfig;
  CUSTOM_FUNCTION: CustomFunctionActionConfig;

  // Shell actions
  SHELL: ShellActionConfig;
  SHELL_SCRIPT: ShellScriptActionConfig;

  // AI actions
  AI_PROMPT: AIPromptActionConfig;
  RUN_PROMPT_SEQUENCE: RunPromptSequenceActionConfig;
}

// ============================================================================
// Action Structure
// ============================================================================

/**
 * Action - the fundamental unit of workflow execution
 *
 * Every action has a position in the graph and connects to other actions.
 */
export interface Action<T extends ActionType = ActionType> {
  /** Unique action identifier */
  id: string;

  /** Action type */
  type: T;

  /** Human-readable name */
  name?: string;

  /** Type-specific configuration */
  config: ActionConfigMap[T];

  /** Base settings (timing, logging, etc.) */
  base?: BaseActionSettings;

  /** Execution control (timeout, retries, etc.) */
  execution?: ExecutionSettings;

  /**
   * Position in graph [x, y]
   * REQUIRED for all actions in graph format
   */
  position: [number, number];

  /** Action-level expectations for checkpoint and failure behavior */
  expectations?: ActionExpectations;
}

// ============================================================================
// Graph Connections
// ============================================================================

/**
 * Edge condition for conditional routing
 */
export interface EdgeCondition {
  /** Condition type */
  type: "expression" | "variable" | "always" | "timeout" | "retry-exhausted";

  /** JavaScript expression to evaluate (for type: "expression") */
  expression?: string;

  /** Variable name to check (for type: "variable") */
  variable?: string;

  /** Comparison operator (for type: "variable") */
  operator?:
    | "equals"
    | "not-equals"
    | "greater"
    | "less"
    | "contains"
    | "exists";

  /** Value to compare against (for type: "variable") */
  value?: string | number | boolean;
}

/**
 * Connection from one action's output to another action's input
 */
export interface Connection {
  /** Target action ID */
  action: string;

  /** Connection type - determines which output is used */
  type: "main" | "error" | "success" | "parallel";

  /** Input index on the target action (usually 0) */
  index: number;

  // ========== Edge Properties (optional) ==========

  /** Human-readable label displayed on the edge */
  label?: string;

  /** Condition that must be met to follow this edge */
  condition?: EdgeCondition;

  /** Priority/probability weight (0-100), higher = more likely/important */
  weight?: number;

  /** Optional description for documentation */
  description?: string;
}

/**
 * All connections originating from actions in the workflow
 *
 * Structure: connections[sourceActionId][outputType][outputIndex][connectionIndex]
 *
 * @example Simple linear connection
 * {
 *   'action-1': {
 *     main: [[{ action: 'action-2', type: 'main', index: 0 }]]
 *   }
 * }
 *
 * @example IF action with branches
 * {
 *   'action-if-1': {
 *     main: [
 *       [{ action: 'action-true', type: 'main', index: 0 }],   // Output 0: true branch
 *       [{ action: 'action-false', type: 'main', index: 0 }]   // Output 1: false branch
 *     ]
 *   }
 * }
 */
export interface Connections {
  [sourceActionId: string]: {
    /** Normal execution flow connections */
    main?: Connection[][];

    /** Error/exception flow connections */
    error?: Connection[][];

    /** Success condition flow connections */
    success?: Connection[][];
  };
}

// ============================================================================
// Workflow Variables
// ============================================================================

/**
 * Workflow variables at different scopes
 */
export interface WorkflowVariables {
  /** Local variables - scoped to single workflow execution */
  local?: Record<string, unknown>;

  /** Process variables - persist across workflow executions */
  process?: Record<string, unknown>;

  /** Global variables - persist across all processes */
  global?: Record<string, unknown>;
}

// ============================================================================
// Workflow Settings
// ============================================================================

/**
 * Workflow execution settings
 *
 * Note: Model-based GUI automation is resilient by design - workflows always
 * continue executing even if individual actions fail. This makes automation
 * robust and flexible, able to handle unexpected states gracefully.
 */
export interface WorkflowSettings {
  /** Maximum execution time in milliseconds */
  timeout?: number;

  /** Number of retry attempts on failure */
  maxRetries?: number;

  /** Delay between retry attempts in milliseconds */
  retryDelay?: number;

  /** Enable parallel execution where possible */
  enableParallelExecution?: boolean;

  /** Log level for workflow execution */
  logLevel?: "debug" | "info" | "warning" | "error";
}

// ============================================================================
// Workflow Metadata
// ============================================================================

/**
 * Workflow metadata for documentation and tracking
 */
export interface WorkflowMetadata {
  /** ISO timestamp when workflow was created */
  created?: string;

  /** ISO timestamp when workflow was last updated */
  updated?: string;

  /** Author or creator of the workflow */
  author?: string;

  /** Description of workflow purpose and behavior */
  description?: string;

  /** Semantic version of the workflow */
  version?: string;

  /**
   * Preferred view mode for this workflow
   * - 'sequential': Open in sequential/timeline editor
   * - 'graph': Open in visual graph editor
   * This is just a UI hint - all workflows are stored in graph format
   */
  viewMode?: "sequential" | "graph";

  /** Additional custom metadata */
  [key: string]: unknown;
}

// ============================================================================
// Workflow Structure
// ============================================================================

/**
 * Complete workflow definition - Unified graph format
 *
 * All workflows are graph-based with connections and positions.
 * Sequential processes are just linear graphs (no branching).
 *
 * @example Sequential workflow (linear graph)
 * {
 *   id: 'wf-1',
 *   name: 'Login Flow',
 *   version: '1.0.0',
 *   format: 'graph',
 *   category: 'Main',
 *   description: 'Login to the application',
 *   actions: [
 *     { id: 'a1', type: 'CLICK', config: {...}, position: [100, 100] },
 *     { id: 'a2', type: 'TYPE', config: {...}, position: [100, 250] }
 *   ],
 *   connections: {
 *     'a1': { main: [[{ action: 'a2', type: 'main', index: 0 }]] }
 *   },
 *   metadata: {
 *     viewMode: 'sequential'  // Hint that this should open in sequential view
 *   }
 * }
 *
 * @example Graph workflow (with branching)
 * {
 *   id: 'wf-2',
 *   name: 'Error Handler',
 *   version: '1.0.0',
 *   format: 'graph',
 *   category: 'Utilities',
 *   actions: [
 *     { id: 'a1', type: 'IF', config: {...}, position: [100, 100] },
 *     { id: 'a2', type: 'CLICK', config: {...}, position: [50, 250] },
 *     { id: 'a3', type: 'CLICK', config: {...}, position: [250, 250] }
 *   ],
 *   connections: {
 *     'a1': {
 *       main: [
 *         [{ action: 'a2', type: 'main', index: 0 }],  // true branch
 *         [{ action: 'a3', type: 'main', index: 0 }]   // false branch
 *       ]
 *     }
 *   }
 * }
 */
export interface Workflow {
  /** Unique workflow identifier */
  id: string;

  /** Human-readable workflow name */
  name: string;

  /** Workflow schema version */
  version: string;

  /** Workflow format - always 'graph' */
  format: "graph";

  /** Actions that make up this workflow */
  actions: Action[];

  /** Graph connections between actions - REQUIRED */
  connections: Connections;

  // ============================================================================
  // Organization & Categorization (from Process)
  // ============================================================================

  /**
   * Category for organizing workflows
   * Workflows in "Main" category are executable from qontinui-runner
   */
  category?: string;

  /** Description of workflow purpose and behavior */
  description?: string;

  // ============================================================================
  // State Machine Configuration
  // ============================================================================

  /**
   * Screenshot to start integration tests with
   * Used for mock/simulated test runs
   */
  initialScreenshotId?: string;

  /**
   * States that should be active when this workflow starts.
   * Required for Main category workflows to enable model-based GUI automation.
   * The qontinui library uses these to initialize the state machine.
   */
  initialStateIds?: string[];

  // ============================================================================
  // Advanced Features
  // ============================================================================

  /** Workflow variables at different scopes */
  variables?: WorkflowVariables;

  /** Workflow execution settings */
  settings?: WorkflowSettings;

  /**
   * Workflow metadata (documentation, versioning, etc.)
   *
   * Special metadata fields:
   * - viewMode: 'sequential' | 'graph' - UI hint for which editor to open
   * - created: ISO timestamp
   * - updated: ISO timestamp
   * - author: string
   */
  metadata?: WorkflowMetadata;

  /** Tags for categorization and search */
  tags?: string[];

  /** Workflow-level expectations (success criteria, checkpoints, global settings) */
  expectations?: WorkflowExpectations;
}

// ============================================================================
// Multi-Output Actions
// ============================================================================

/**
 * Action types that can have multiple outputs
 */
export const MULTI_OUTPUT_ACTIONS = {
  /** IF action: 2 outputs (true branch, false branch) */
  IF: 2,

  /** SWITCH action: N outputs (one per case + default) */
  SWITCH: -1, // Variable based on cases

  /** TRY_CATCH action: 2 outputs (success, error) */
  TRY_CATCH: 2,
} as const;

/**
 * Get the number of outputs for a given action type
 */
export function getActionOutputCount(
  actionType: string,
  config?: unknown
): number {
  if (actionType === "IF" || actionType === "TRY_CATCH") {
    return MULTI_OUTPUT_ACTIONS[actionType];
  }

  if (actionType === "SWITCH") {
    const switchConfig = config as { cases?: unknown[] } | undefined;
    if (switchConfig?.cases && Array.isArray(switchConfig.cases)) {
      return switchConfig.cases.length + 1;
    }
  }

  return 1;
}

/**
 * Get the number of inputs for a given action type
 * Currently all actions have exactly 1 input
 */
export function getActionInputCount(): number {
  return 1;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard to check if an action is of a specific type
 */
export function isActionOfType<T extends ActionType>(
  action: Action,
  type: T
): action is Action<T> {
  return action.type === type;
}

/**
 * Helper type to extract config type from action type
 */
export type ConfigForAction<T extends ActionType> = ActionConfigMap[T];

/**
 * Create a typed action
 */
export function createAction<T extends ActionType>(
  type: T,
  config: ActionConfigMap[T],
  position: [number, number],
  options?: {
    id?: string;
    name?: string;
    base?: BaseActionSettings;
    execution?: ExecutionSettings;
  }
): Action<T> {
  return {
    id:
      options?.id ||
      `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type,
    name: options?.name,
    config,
    base: options?.base,
    execution: options?.execution,
    position,
  };
}
