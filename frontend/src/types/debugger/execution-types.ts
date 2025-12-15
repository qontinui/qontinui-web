import type { Action } from "../../lib/action-schema/action-types";

export type ExecutionState =
  | "idle"
  | "running"
  | "paused"
  | "stepping"
  | "completed"
  | "error";
export type ActionExecutionStatus =
  | "pending"
  | "executing"
  | "success"
  | "failed"
  | "skipped";
export type ExecutionSpeed = "slow" | "normal" | "fast";

export interface VariableValue {
  value: unknown;
  type: string;
  lastModified: number;
  previousValue?: unknown;
}

export interface ExecutionContext {
  variables: Record<string, VariableValue>;
  loopIterations: Record<string, number>;
  callStack: string[];
}

export interface ConditionEvaluation {
  actionId: string;
  condition: string;
  result: boolean;
  evaluatedAt: number;
  variables: Record<string, unknown>;
  branch: "if" | "else" | "elseif";
}

export interface LoopState {
  actionId: string;
  currentIteration: number;
  maxIterations: number;
  loopVariable?: string;
  startTime: number;
}

export interface ActionExecutionEvent {
  id: string;
  actionIndex: number;
  action: Action;
  status: ActionExecutionStatus;
  startTime?: number;
  endTime?: number;
  duration?: number;
  result?: unknown;
  error?: string;
  stackTrace?: string;
  executionCount: number;
}

export interface BreakpointConfig {
  actionIndex: number;
  enabled: boolean;
  condition?: string;
}

export interface ExecutionLogEntry {
  id: string;
  timestamp: number;
  level: "info" | "warning" | "error" | "debug";
  category: "action" | "condition" | "loop" | "variable" | "system";
  message: string;
  actionIndex?: number;
  details?: unknown;
}

export interface ExecutionDebuggerState {
  // Execution state
  state: ExecutionState;
  currentActionIndex: number;
  totalActions: number;
  startTime?: number;
  endTime?: number;

  // Action tracking
  actionEvents: ActionExecutionEvent[];
  executionHistory: ActionExecutionEvent[];

  // Control flow tracking
  conditionEvaluations: ConditionEvaluation[];
  loopStates: LoopState[];

  // Variable tracking
  context: ExecutionContext;
  variableHistory: Array<{
    timestamp: number;
    variableName: string;
    value: unknown;
    actionIndex: number;
  }>;

  // Breakpoints
  breakpoints: BreakpointConfig[];

  // Execution controls
  speed: ExecutionSpeed;
  stepMode: boolean;

  // Logging
  logs: ExecutionLogEntry[];

  // Performance metrics
  metrics: {
    totalExecutionTime: number;
    averageActionTime: number;
    successRate: number;
  };
}
