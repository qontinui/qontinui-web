import { create } from "zustand";
import {
  ExecutionDebuggerState,
  ExecutionState,
  ActionExecutionEvent,
  ConditionEvaluation,
  LoopState,
  ExecutionLogEntry,
  VariableValue,
  ExecutionSpeed,
} from "../types/debugger/execution-types";
import type { Action } from "../lib/action-schema/action-types";
import { evaluateCondition } from "../lib/safe-eval";

interface ExecutionDebuggerStore extends ExecutionDebuggerState {
  // State management
  setState: (state: ExecutionState) => void;
  reset: () => void;
  initialize: (totalActions: number) => void;

  // Action execution tracking
  startAction: (actionIndex: number, action: Action) => void;
  completeAction: (
    actionIndex: number,
    result: unknown,
    error?: string
  ) => void;
  failAction: (actionIndex: number, error: string, stackTrace?: string) => void;
  skipAction: (actionIndex: number, reason: string) => void;

  // Control flow tracking
  recordConditionEvaluation: (evaluation: ConditionEvaluation) => void;
  startLoop: (
    actionId: string,
    maxIterations: number,
    loopVariable?: string
  ) => void;
  updateLoopIteration: (actionId: string) => void;
  endLoop: (actionId: string) => void;

  // Variable management
  setVariable: (name: string, value: unknown, actionIndex: number) => void;
  getVariable: (name: string) => unknown;
  deleteVariable: (name: string) => void;

  // Breakpoint management
  addBreakpoint: (actionIndex: number, condition?: string) => void;
  removeBreakpoint: (actionIndex: number) => void;
  toggleBreakpoint: (actionIndex: number) => void;
  shouldBreakAt: (actionIndex: number) => boolean;

  // Execution controls
  play: () => void;
  pause: () => void;
  stop: () => void;
  step: () => void;
  setSpeed: (speed: ExecutionSpeed) => void;

  // Logging
  addLog: (
    level: ExecutionLogEntry["level"],
    category: ExecutionLogEntry["category"],
    message: string,
    actionIndex?: number,
    details?: unknown
  ) => void;
  clearLogs: () => void;
  exportLogs: () => string;

  // Metrics
  updateMetrics: () => void;

  // Enable/disable debugging
  debugEnabled: boolean;
  setDebugEnabled: (enabled: boolean) => void;
}

const initialState: ExecutionDebuggerState = {
  state: "idle",
  currentActionIndex: -1,
  totalActions: 0,
  actionEvents: [],
  executionHistory: [],
  conditionEvaluations: [],
  loopStates: [],
  context: {
    variables: {},
    loopIterations: {},
    callStack: [],
  },
  variableHistory: [],
  breakpoints: [],
  speed: "normal",
  stepMode: false,
  logs: [],
  metrics: {
    totalExecutionTime: 0,
    averageActionTime: 0,
    successRate: 0,
  },
};

export const useExecutionDebugger = create<ExecutionDebuggerStore>(
  (set, get) => ({
    ...initialState,
    debugEnabled: false,

    setState: (state: ExecutionState) => {
      set({ state });
      get().addLog("info", "system", `Execution state changed to: ${state}`);
    },

    reset: () => {
      set({
        ...initialState,
        debugEnabled: get().debugEnabled,
      });
    },

    initialize: (totalActions: number) => {
      set({
        ...initialState,
        totalActions,
        state: "idle",
        startTime: undefined,
        debugEnabled: get().debugEnabled,
      });
      get().addLog(
        "info",
        "system",
        `Initialized debugger with ${totalActions} actions`
      );
    },

    startAction: (actionIndex: number, action: Action) => {
      const now = Date.now();
      const existingEvent = get().actionEvents.find(
        (e) => e.actionIndex === actionIndex
      );
      const executionCount = existingEvent
        ? existingEvent.executionCount + 1
        : 1;

      const event: ActionExecutionEvent = {
        id: `${actionIndex}-${now}`,
        actionIndex,
        action,
        status: "executing",
        startTime: now,
        executionCount,
      };

      set((state) => ({
        currentActionIndex: actionIndex,
        actionEvents: [
          ...state.actionEvents.filter((e) => e.actionIndex !== actionIndex),
          event,
        ],
        startTime: state.startTime || now,
      }));

      get().addLog(
        "info",
        "action",
        `Executing: ${action.type}`,
        actionIndex,
        action.config
      );
    },

    completeAction: (actionIndex: number, result: unknown, error?: string) => {
      const now = Date.now();
      const event = get().actionEvents.find(
        (e) => e.actionIndex === actionIndex
      );

      if (event) {
        const completedEvent: ActionExecutionEvent = {
          ...event,
          status: error ? "failed" : "success",
          endTime: now,
          duration: event.startTime ? now - event.startTime : 0,
          result,
          error,
        };

        set((state) => ({
          actionEvents: state.actionEvents.map((e) =>
            e.actionIndex === actionIndex ? completedEvent : e
          ),
          executionHistory: [...state.executionHistory, completedEvent].slice(
            -1000
          ),
        }));

        get().addLog(
          error ? "error" : "info",
          "action",
          error ? `Failed: ${error}` : `Completed: ${event.action.type}`,
          actionIndex,
          { result, duration: completedEvent.duration }
        );

        get().updateMetrics();
      }
    },

    failAction: (actionIndex: number, error: string, stackTrace?: string) => {
      const now = Date.now();
      const event = get().actionEvents.find(
        (e) => e.actionIndex === actionIndex
      );

      if (event) {
        const failedEvent: ActionExecutionEvent = {
          ...event,
          status: "failed",
          endTime: now,
          duration: event.startTime ? now - event.startTime : 0,
          error,
          stackTrace,
        };

        set((state) => ({
          actionEvents: state.actionEvents.map((e) =>
            e.actionIndex === actionIndex ? failedEvent : e
          ),
          executionHistory: [...state.executionHistory, failedEvent].slice(
            -1000
          ),
          state: "error",
        }));

        get().addLog(
          "error",
          "action",
          `Action failed: ${error}`,
          actionIndex,
          {
            stackTrace,
          }
        );

        get().updateMetrics();
      }
    },

    skipAction: (actionIndex: number, reason: string) => {
      const event = get().actionEvents.find(
        (e) => e.actionIndex === actionIndex
      );

      if (event) {
        const skippedEvent: ActionExecutionEvent = {
          ...event,
          status: "skipped",
        };

        set((state) => ({
          actionEvents: state.actionEvents.map((e) =>
            e.actionIndex === actionIndex ? skippedEvent : e
          ),
        }));

        get().addLog(
          "warning",
          "action",
          `Action skipped: ${reason}`,
          actionIndex
        );
      }
    },

    recordConditionEvaluation: (evaluation: ConditionEvaluation) => {
      set((state) => ({
        conditionEvaluations: [...state.conditionEvaluations, evaluation].slice(
          -500
        ),
      }));

      get().addLog(
        "debug",
        "condition",
        `Condition evaluated: ${evaluation.condition} = ${evaluation.result} (${evaluation.branch} branch)`,
        undefined,
        evaluation
      );
    },

    startLoop: (
      actionId: string,
      maxIterations: number,
      loopVariable?: string
    ) => {
      const loopState: LoopState = {
        actionId,
        currentIteration: 0,
        maxIterations,
        loopVariable,
        startTime: Date.now(),
      };

      set((state) => ({
        loopStates: [...state.loopStates, loopState],
        context: {
          ...state.context,
          loopIterations: {
            ...state.context.loopIterations,
            [actionId]: 0,
          },
        },
      }));

      get().addLog(
        "info",
        "loop",
        `Loop started: ${actionId} (max: ${maxIterations})`,
        undefined,
        {
          loopVariable,
        }
      );
    },

    updateLoopIteration: (actionId: string) => {
      set((state) => ({
        loopStates: state.loopStates.map((loop) =>
          loop.actionId === actionId
            ? { ...loop, currentIteration: loop.currentIteration + 1 }
            : loop
        ),
        context: {
          ...state.context,
          loopIterations: {
            ...state.context.loopIterations,
            [actionId]: (state.context.loopIterations[actionId] || 0) + 1,
          },
        },
      }));

      const loop = get().loopStates.find((l) => l.actionId === actionId);
      if (loop) {
        get().addLog(
          "debug",
          "loop",
          `Loop iteration: ${loop.currentIteration + 1}/${loop.maxIterations}`,
          undefined,
          { actionId }
        );
      }
    },

    endLoop: (actionId: string) => {
      const loop = get().loopStates.find((l) => l.actionId === actionId);
      const duration = loop ? Date.now() - loop.startTime : 0;

      set((state) => ({
        loopStates: state.loopStates.filter((l) => l.actionId !== actionId),
      }));

      get().addLog("info", "loop", `Loop completed: ${actionId}`, undefined, {
        duration,
        iterations: loop?.currentIteration,
      });
    },

    setVariable: (name: string, value: unknown, actionIndex: number) => {
      const now = Date.now();
      const previousValue = get().context.variables[name]?.value;

      const variableValue: VariableValue = {
        value,
        type: typeof value,
        lastModified: now,
        previousValue,
      };

      set((state) => ({
        context: {
          ...state.context,
          variables: {
            ...state.context.variables,
            [name]: variableValue,
          },
        },
        variableHistory: [
          ...state.variableHistory,
          {
            timestamp: now,
            variableName: name,
            value,
            actionIndex,
          },
        ].slice(-1000),
      }));

      get().addLog(
        "debug",
        "variable",
        `Variable set: ${name} = ${JSON.stringify(value)}`,
        actionIndex,
        {
          previousValue,
        }
      );
    },

    getVariable: (name: string) => {
      return get().context.variables[name]?.value;
    },

    deleteVariable: (name: string) => {
      set((state) => {
        const { [name]: _deleted, ...rest } = state.context.variables;
        return {
          context: {
            ...state.context,
            variables: rest,
          },
        };
      });

      get().addLog("debug", "variable", `Variable deleted: ${name}`);
    },

    addBreakpoint: (actionIndex: number, condition?: string) => {
      set((state) => ({
        breakpoints: [
          ...state.breakpoints.filter((bp) => bp.actionIndex !== actionIndex),
          { actionIndex, enabled: true, condition },
        ],
      }));

      get().addLog(
        "info",
        "system",
        `Breakpoint added at action ${actionIndex}`,
        actionIndex,
        {
          condition,
        }
      );
    },

    removeBreakpoint: (actionIndex: number) => {
      set((state) => ({
        breakpoints: state.breakpoints.filter(
          (bp) => bp.actionIndex !== actionIndex
        ),
      }));

      get().addLog(
        "info",
        "system",
        `Breakpoint removed at action ${actionIndex}`,
        actionIndex
      );
    },

    toggleBreakpoint: (actionIndex: number) => {
      const breakpoint = get().breakpoints.find(
        (bp) => bp.actionIndex === actionIndex
      );

      if (breakpoint) {
        set((state) => ({
          breakpoints: state.breakpoints.map((bp) =>
            bp.actionIndex === actionIndex
              ? { ...bp, enabled: !bp.enabled }
              : bp
          ),
        }));
      } else {
        get().addBreakpoint(actionIndex);
      }
    },

    shouldBreakAt: (actionIndex: number) => {
      const breakpoint = get().breakpoints.find(
        (bp) => bp.actionIndex === actionIndex && bp.enabled
      );

      if (!breakpoint) return false;

      // If no condition is set, always break
      if (!breakpoint.condition || breakpoint.condition.trim() === "") {
        return true;
      }

      // Evaluate the condition with current variables
      try {
        const variables = get().context.variables;
        const variableValues: Record<string, unknown> = {};

        // Extract raw values from VariableValue objects
        for (const [name, varValue] of Object.entries(variables)) {
          variableValues[name] = varValue.value;
        }

        // Evaluate the condition expression safely with variable access
        const result = evaluateCondition(
          breakpoint.condition,
          variableValues as Record<string, unknown>
        );

        get().addLog(
          "debug",
          "system",
          `Breakpoint condition evaluated: ${breakpoint.condition} = ${result}`,
          actionIndex,
          { condition: breakpoint.condition, variables: variableValues, result }
        );

        return Boolean(result);
      } catch (error) {
        // If condition evaluation fails, log the error and don't break
        get().addLog(
          "error",
          "system",
          `Failed to evaluate breakpoint condition: ${error instanceof Error ? error.message : String(error)}`,
          actionIndex,
          { condition: breakpoint.condition, error }
        );
        return false;
      }
    },

    play: () => {
      set({ state: "running", stepMode: false });
      get().addLog("info", "system", "Execution started");
    },

    pause: () => {
      set({ state: "paused" });
      get().addLog("info", "system", "Execution paused");
    },

    stop: () => {
      set({
        state: "idle",
        currentActionIndex: -1,
        endTime: Date.now(),
      });
      get().addLog("info", "system", "Execution stopped");
      get().updateMetrics();
    },

    step: () => {
      set({ state: "stepping", stepMode: true });
      get().addLog("debug", "system", "Step forward");
    },

    setSpeed: (speed: ExecutionSpeed) => {
      set({ speed });
      get().addLog("info", "system", `Execution speed set to: ${speed}`);
    },

    addLog: (level, category, message, actionIndex?, details?) => {
      const log: ExecutionLogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        level,
        category,
        message,
        actionIndex,
        details,
      };

      set((state) => ({
        logs: [...state.logs, log].slice(-2000),
      }));
    },

    clearLogs: () => {
      set({ logs: [] });
    },

    exportLogs: () => {
      const logs = get().logs;
      return JSON.stringify(logs, null, 2);
    },

    updateMetrics: () => {
      const { executionHistory, startTime, endTime } = get();

      const successfulActions = executionHistory.filter(
        (e) => e.status === "success"
      ).length;
      const totalExecutionTime = endTime && startTime ? endTime - startTime : 0;

      const actionTimes = executionHistory
        .filter((e) => e.duration !== undefined)
        .map((e) => e.duration!);

      const averageActionTime =
        actionTimes.length > 0
          ? actionTimes.reduce((sum, time) => sum + time, 0) /
            actionTimes.length
          : 0;

      const successRate =
        executionHistory.length > 0
          ? (successfulActions / executionHistory.length) * 100
          : 0;

      set({
        metrics: {
          totalExecutionTime,
          averageActionTime,
          successRate,
        },
      });
    },

    setDebugEnabled: (enabled: boolean) => {
      set({ debugEnabled: enabled });
      if (enabled) {
        get().addLog("info", "system", "Debugger enabled");
      } else {
        get().reset();
      }
    },
  })
);
