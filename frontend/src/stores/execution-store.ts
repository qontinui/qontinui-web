/**
 * Execution Store - Zustand state management for workflow execution
 *
 * This store manages:
 * - Current execution state
 * - Action execution states
 * - Execution events stream
 * - Execution control (start, pause, resume, cancel)
 * - Execution history
 * - Real-time updates from backend
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { toast } from 'sonner';
import type { Workflow } from '@/lib/action-schema/action-types';
import {
  backendAPI,
  type ExecutionHandle,
  type ExecutionEvent,
  type ExecutionStatusDetail,
  type ExecutionOptions,
  type ActionExecutionStatus,
  type ExecutionRecord,
  type ExecutionStatus,
} from '@/services/backend-api';
import {
  type ClassifiedError,
  WebSocketErrorCode,
} from '@/services/execution-websocket';

// ============================================================================
// Types
// ============================================================================

/**
 * Action execution state with timing information
 */
export interface ActionExecutionState {
  /** Execution status */
  status: ActionExecutionStatus;

  /** Start time */
  startTime?: Date;

  /** End time */
  endTime?: Date;

  /** Execution duration (ms) */
  duration?: number;

  /** Error message if failed */
  error?: string;

  /** Error stack trace */
  stack?: string;

  /** Result data */
  result?: any;

  /** Number of times executed (for loops) */
  executionCount?: number;
}

/**
 * Execution statistics
 */
export interface ExecutionStatistics {
  /** Total actions */
  totalActions: number;

  /** Completed actions */
  completedActions: number;

  /** Failed actions */
  failedActions: number;

  /** Skipped actions */
  skippedActions: number;

  /** Pending actions */
  pendingActions: number;

  /** Execution duration (ms) */
  duration: number;

  /** Average action duration (ms) */
  averageActionDuration: number;

  /** Success rate (0-1) */
  successRate: number;
}

/**
 * Execution store state
 */
export interface ExecutionState {
  // Current execution
  currentExecution: ExecutionHandle | null;
  executionStatus: ExecutionStatusDetail | null;
  actionStates: Record<string, ActionExecutionState>;
  executionEvents: ExecutionEvent[];
  isExecuting: boolean;

  // Streaming
  streamCleanup: (() => void) | null;
  isStreaming: boolean;

  // Polling
  pollTimeoutId: NodeJS.Timeout | null;

  // History
  executionHistory: ExecutionRecord[];

  // Error state
  lastError: Error | null;

  // UI state
  showExecutionPanel: boolean;
  selectedActionId: string | null;

  // Variables
  currentVariables: Record<string, any>;
}

/**
 * Execution store actions
 */
export interface ExecutionActions {
  // Execution control
  startExecution: (workflow: Workflow, options?: ExecutionOptions) => Promise<void>;
  pauseExecution: () => Promise<void>;
  resumeExecution: () => Promise<void>;
  stepExecution: () => Promise<void>;
  cancelExecution: () => Promise<void>;
  clearExecution: () => void;

  // State updates
  updateActionState: (actionId: string, state: Partial<ActionExecutionState>) => void;
  addExecutionEvent: (event: ExecutionEvent) => void;
  setExecutionStatus: (status: ExecutionStatusDetail) => void;
  updateVariables: (variables: Record<string, any>) => void;
  processExecutionEvent: (event: ExecutionEvent) => void;

  // History
  loadExecutionHistory: (workflowId: string, limit?: number) => Promise<void>;
  addToHistory: (record: ExecutionRecord) => void;
  clearHistory: () => void;

  // UI
  toggleExecutionPanel: () => void;
  selectAction: (actionId: string | null) => void;

  // Statistics
  getStatistics: () => ExecutionStatistics;

  // Streaming
  startStreaming: (executionId: string) => void;
  stopStreaming: () => void;

  // Polling (fallback when WebSocket unavailable)
  startPolling: (executionId: string) => void;
  stopPolling: () => void;
}

export type ExecutionStore = ExecutionState & ExecutionActions;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle WebSocket error with user-friendly toast notifications
 */
function handleWebSocketError(error: ClassifiedError | Error): void {
  // Check if error is already classified
  if ('code' in error && 'retryable' in error) {
    const classified = error as ClassifiedError;

    // Show user-friendly toast based on error type
    switch (classified.code) {
      case WebSocketErrorCode.NETWORK_ERROR:
        toast.warning(classified.userMessage || 'Network connection lost. Attempting to reconnect...', {
          description: 'Check your internet connection',
        });
        break;

      case WebSocketErrorCode.AUTH_ERROR:
        toast.error(classified.userMessage || 'Authentication failed. Please log in again.', {
          description: 'Your session may have expired',
          action: {
            label: 'Log in',
            onClick: () => window.location.href = '/login',
          },
        });
        break;

      case WebSocketErrorCode.TIMEOUT_ERROR:
        toast.warning(classified.userMessage || 'Connection timed out. Retrying...', {
          description: 'Server is not responding',
        });
        break;

      case WebSocketErrorCode.PROTOCOL_ERROR:
        toast.error(classified.userMessage || 'Protocol error. Attempting to reconnect...', {
          description: 'Please refresh the page if issue persists',
        });
        break;

      case WebSocketErrorCode.SERVER_ERROR:
      default:
        if (classified.retryable) {
          toast.warning(classified.userMessage || 'Server error occurred. Attempting to reconnect...', {
            description: 'Please wait while we reconnect',
          });
        } else {
          toast.error(classified.userMessage || 'Server error occurred', {
            description: 'Please try again later',
          });
        }
        break;
    }
  } else {
    // Fallback for unclassified errors
    const rawError = error as Error;
    toast.error('Execution stream error', {
      description: rawError.message,
    });
  }
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: ExecutionState = {
  currentExecution: null,
  executionStatus: null,
  actionStates: {},
  executionEvents: [],
  isExecuting: false,

  streamCleanup: null,
  isStreaming: false,

  pollTimeoutId: null,

  executionHistory: [],

  lastError: null,

  showExecutionPanel: false,
  selectedActionId: null,

  currentVariables: {},
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useExecutionStore = create<ExecutionStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // ========================================================================
      // Execution Control
      // ========================================================================

      startExecution: async (workflow: Workflow, options?: ExecutionOptions) => {
        try {
          // Stop any existing execution
          get().cancelExecution();

          // Start execution on backend
          const handle = await backendAPI.executeWorkflow(workflow, options);

          set({
            currentExecution: handle,
            isExecuting: true,
            actionStates: {},
            executionEvents: [],
            lastError: null,
            showExecutionPanel: true,
          });

          // Initialize action states
          const actionStates: Record<string, ActionExecutionState> = {};
          for (const action of workflow.actions) {
            actionStates[action.id] = {
              status: 'idle',
            };
          }
          set({ actionStates });

          // Start streaming events
          get().startStreaming(handle.executionId);

          // Start polling status updates
          get().startPolling(handle.executionId);

          console.log('[ExecutionStore] Execution started:', handle.executionId);
        } catch (error) {
          console.error('[ExecutionStore] Failed to start execution:', error);
          set({
            lastError: error as Error,
            isExecuting: false,
          });
          throw error;
        }
      },

      pauseExecution: async () => {
        const { currentExecution } = get();
        if (!currentExecution) {
          throw new Error('No execution in progress');
        }

        try {
          await backendAPI.pauseExecution(currentExecution.executionId);
          console.log('[ExecutionStore] Execution paused');
        } catch (error) {
          console.error('[ExecutionStore] Failed to pause execution:', error);
          set({ lastError: error as Error });
          throw error;
        }
      },

      resumeExecution: async () => {
        const { currentExecution } = get();
        if (!currentExecution) {
          throw new Error('No execution to resume');
        }

        try {
          await backendAPI.resumeExecution(currentExecution.executionId);
          console.log('[ExecutionStore] Execution resumed');
        } catch (error) {
          console.error('[ExecutionStore] Failed to resume execution:', error);
          set({ lastError: error as Error });
          throw error;
        }
      },

      stepExecution: async () => {
        const { currentExecution } = get();
        if (!currentExecution) {
          throw new Error('No execution in progress');
        }

        try {
          await backendAPI.stepExecution(currentExecution.executionId);
          console.log('[ExecutionStore] Execution stepped');
        } catch (error) {
          console.error('[ExecutionStore] Failed to step execution:', error);
          set({ lastError: error as Error });
          throw error;
        }
      },

      cancelExecution: async () => {
        const { currentExecution, streamCleanup } = get();

        if (!currentExecution) {
          return;
        }

        try {
          // Stop streaming
          if (streamCleanup) {
            streamCleanup();
          }

          // Stop polling
          get().stopPolling();

          // Cancel on backend
          await backendAPI.cancelExecution(currentExecution.executionId);

          set({
            currentExecution: null,
            executionStatus: null,
            isExecuting: false,
            streamCleanup: null,
            isStreaming: false,
            pollTimeoutId: null,
          });

          console.log('[ExecutionStore] Execution cancelled');
        } catch (error) {
          console.error('[ExecutionStore] Failed to cancel execution:', error);
          set({ lastError: error as Error });
          throw error;
        }
      },

      clearExecution: () => {
        const { streamCleanup } = get();

        // Stop streaming
        if (streamCleanup) {
          streamCleanup();
        }

        // Stop polling
        get().stopPolling();

        set({
          currentExecution: null,
          executionStatus: null,
          actionStates: {},
          executionEvents: [],
          isExecuting: false,
          streamCleanup: null,
          isStreaming: false,
          pollTimeoutId: null,
          currentVariables: {},
        });
      },

      // ========================================================================
      // State Updates
      // ========================================================================

      updateActionState: (actionId: string, stateUpdate: Partial<ActionExecutionState>) => {
        set((state) => {
          const currentState = state.actionStates[actionId] || { status: 'idle' };
          const newState = { ...currentState, ...stateUpdate };

          // Calculate duration if both times available
          if (newState.startTime && newState.endTime) {
            newState.duration = newState.endTime.getTime() - newState.startTime.getTime();
          }

          return {
            actionStates: {
              ...state.actionStates,
              [actionId]: newState,
            },
          };
        });
      },

      addExecutionEvent: (event: ExecutionEvent) => {
        set((state) => ({
          executionEvents: [...state.executionEvents, event],
        }));

        // Process event to update states
        get().processExecutionEvent(event);
      },

      setExecutionStatus: (status: ExecutionStatusDetail) => {
        set({ executionStatus: status });

        // Update action states from status
        const actionStates: Record<string, ActionExecutionState> = {};
        for (const [actionId, actionStatus] of Object.entries(status.actionStates)) {
          actionStates[actionId] = {
            status: actionStatus,
            ...(get().actionStates[actionId] || {}),
          };
        }

        set({ actionStates });

        // Update variables
        if (status.variables) {
          set({ currentVariables: status.variables });
        }

        // Check if execution completed
        if (
          status.status === 'completed' ||
          status.status === 'failed' ||
          status.status === 'cancelled'
        ) {
          set({ isExecuting: false });
          get().stopStreaming();
          get().stopPolling();

          // Add to history
          if (status.endTime) {
            get().addToHistory({
              executionId: status.executionId,
              workflowId: status.workflowId,
              workflowName: '',
              startTime: status.startTime,
              endTime: status.endTime,
              status: status.status,
              duration: status.endTime.getTime() - status.startTime.getTime(),
              totalActions: status.totalActions,
              completedActions: status.completedActions,
              failedActions: status.failedActions,
              error: status.error?.message,
            });
          }
        }
      },

      updateVariables: (variables: Record<string, any>) => {
        set({ currentVariables: variables });
      },

      // ========================================================================
      // History
      // ========================================================================

      loadExecutionHistory: async (workflowId: string, limit?: number) => {
        try {
          const history = await backendAPI.getExecutionHistory(workflowId, limit);
          set({ executionHistory: history });
        } catch (error) {
          console.error('[ExecutionStore] Failed to load history:', error);
          set({ lastError: error as Error });
        }
      },

      addToHistory: (record: ExecutionRecord) => {
        set((state) => ({
          executionHistory: [record, ...state.executionHistory].slice(0, 100), // Keep last 100
        }));
      },

      clearHistory: () => {
        set({ executionHistory: [] });
      },

      // ========================================================================
      // UI
      // ========================================================================

      toggleExecutionPanel: () => {
        set((state) => ({
          showExecutionPanel: !state.showExecutionPanel,
        }));
      },

      selectAction: (actionId: string | null) => {
        set({ selectedActionId: actionId });
      },

      // ========================================================================
      // Statistics
      // ========================================================================

      getStatistics: () => {
        const { actionStates, executionStatus } = get();

        const totalActions = Object.keys(actionStates).length;
        const completedActions = Object.values(actionStates).filter(
          (s) => s.status === 'completed'
        ).length;
        const failedActions = Object.values(actionStates).filter(
          (s) => s.status === 'failed'
        ).length;
        const skippedActions = Object.values(actionStates).filter(
          (s) => s.status === 'skipped'
        ).length;
        const pendingActions = totalActions - completedActions - failedActions - skippedActions;

        const durations = Object.values(actionStates)
          .filter((s) => s.duration !== undefined)
          .map((s) => s.duration!);
        const averageActionDuration =
          durations.length > 0
            ? durations.reduce((sum, d) => sum + d, 0) / durations.length
            : 0;

        const successRate =
          completedActions + failedActions > 0
            ? completedActions / (completedActions + failedActions)
            : 0;

        const duration = executionStatus
          ? executionStatus.endTime
            ? executionStatus.endTime.getTime() - executionStatus.startTime.getTime()
            : Date.now() - executionStatus.startTime.getTime()
          : 0;

        return {
          totalActions,
          completedActions,
          failedActions,
          skippedActions,
          pendingActions,
          duration,
          averageActionDuration,
          successRate,
        };
      },

      // ========================================================================
      // Streaming
      // ========================================================================

      startStreaming: (executionId: string) => {
        const { streamCleanup } = get();

        // Stop existing stream
        if (streamCleanup) {
          streamCleanup();
        }

        // Start new stream
        const cleanup = backendAPI.streamExecutionEvents(
          executionId,
          (event) => {
            get().addExecutionEvent(event);
          },
          (error) => {
            console.error('[ExecutionStore] Stream error:', error);
            set({ lastError: error });
            // Show user-friendly error notification
            handleWebSocketError(error);
          },
          () => {
            console.log('[ExecutionStore] Stream closed');
            set({ isStreaming: false, streamCleanup: null });
          }
        );

        set({ streamCleanup: cleanup, isStreaming: true });
      },

      stopStreaming: () => {
        const { streamCleanup } = get();
        if (streamCleanup) {
          streamCleanup();
          set({ streamCleanup: null, isStreaming: false });
        }
      },

      // ========================================================================
      // Polling (fallback with exponential backoff)
      // ========================================================================

      startPolling: (executionId: string) => {
        let pollInterval = 1000; // Start at 1s
        const maxInterval = 10000; // Max 10s
        let lastStatus: ExecutionStatus | null = null;

        const poll = async () => {
          try {
            const status = await backendAPI.getExecutionStatus(executionId);
            get().setExecutionStatus(status);

            // Reset interval if status changed
            if (status.status !== lastStatus) {
              pollInterval = 1000;
              lastStatus = status.status;
            }

            // Stop polling if execution completed
            if (
              status.status === 'completed' ||
              status.status === 'failed' ||
              status.status === 'cancelled'
            ) {
              get().stopPolling();
              return;
            }

            // Exponential backoff (1.5x multiplier)
            pollInterval = Math.min(pollInterval * 1.5, maxInterval);

            // Schedule next poll
            const timeoutId = setTimeout(poll, pollInterval);
            set({ pollTimeoutId: timeoutId });
          } catch (error) {
            console.error('[ExecutionStore] Polling error:', error);
            // On error, backoff more aggressively (2x multiplier)
            pollInterval = Math.min(pollInterval * 2, maxInterval);
            const timeoutId = setTimeout(poll, pollInterval);
            set({ pollTimeoutId: timeoutId });
          }
        };

        // Start first poll immediately
        poll();
      },

      stopPolling: () => {
        const timeoutId = get().pollTimeoutId;
        if (timeoutId) {
          clearTimeout(timeoutId);
          set({ pollTimeoutId: null });
        }
      },

      // ========================================================================
      // Event Processing
      // ========================================================================

      processExecutionEvent: (event: ExecutionEvent) => {
        switch (event.type) {
          case 'workflow_start':
            console.log('[ExecutionStore] Workflow started');
            break;

          case 'action_start':
            if (event.actionId) {
              get().updateActionState(event.actionId, {
                status: 'running',
                startTime: event.timestamp,
              });
            }
            break;

          case 'action_complete':
            if (event.actionId) {
              get().updateActionState(event.actionId, {
                status: 'completed',
                endTime: event.timestamp,
                result: event.data?.result,
              });
            }
            break;

          case 'action_error':
            if (event.actionId) {
              get().updateActionState(event.actionId, {
                status: 'failed',
                endTime: event.timestamp,
                error: event.data?.error,
                stack: event.data?.stack,
              });
            }
            break;

          case 'action_skip':
            if (event.actionId) {
              get().updateActionState(event.actionId, {
                status: 'skipped',
              });
            }
            break;

          case 'variable_update':
            if (event.data?.variables) {
              get().updateVariables(event.data.variables);
            }
            break;

          case 'workflow_complete':
            console.log('[ExecutionStore] Workflow completed');
            set({ isExecuting: false });
            break;

          case 'workflow_error':
            console.error('[ExecutionStore] Workflow error:', event.data?.error);
            set({
              isExecuting: false,
              lastError: new Error(event.data?.error || 'Workflow error'),
            });
            break;

          case 'breakpoint':
            console.log('[ExecutionStore] Breakpoint hit:', event.actionId);
            break;

          case 'log':
            console.log(`[Workflow] ${event.data?.message}`);
            break;
        }
      },
    }),
    { name: 'ExecutionStore' }
  )
);

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get action state by ID
 */
export const selectActionState = (actionId: string) => (state: ExecutionStore) =>
  state.actionStates[actionId];

/**
 * Get actions by status
 */
export const selectActionsByStatus =
  (status: ActionExecutionStatus) => (state: ExecutionStore) =>
    Object.entries(state.actionStates)
      .filter(([_, s]) => s.status === status)
      .map(([id]) => id);

/**
 * Check if execution is active
 */
export const selectIsExecuting = (state: ExecutionStore) => state.isExecuting;

/**
 * Get execution progress (0-1)
 */
export const selectExecutionProgress = (state: ExecutionStore) => {
  const stats = state.getStatistics();
  return stats.totalActions > 0
    ? (stats.completedActions + stats.failedActions) / stats.totalActions
    : 0;
};
