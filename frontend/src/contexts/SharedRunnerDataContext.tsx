"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useEventTriggeredFetch,
  useRunnerEvent,
} from "@/contexts/RunnerEventContext";
import { runnerFetch } from "@/lib/runner-api";
import type { CurrentExecutionStepsResponse } from "@/lib/runner-api";

// =============================================================================
// Types
// =============================================================================

export interface OrchestratorState {
  active_agent?: string;
  activity_type?: string;
  current_action?: string;
  is_paused?: boolean;
  bridges_count?: number;
  gui_locked?: boolean;
  plan_phase?: string;
  plan_total_phases?: number;
  workflow_stage?: string;
  phase?: string;
  iteration?: number;
  max_iterations?: number;
}

/**
 * Shape of the inner `data` field from an OrchestratorStateChange WS event.
 * The runner broadcasts: { event_type: "OrchestratorStateChange", data: { ... } }
 */
interface OrchestratorWsEventData {
  task_run_id: string;
  workflow_stage: string;
  iteration: number;
  phase: string;
  state_data?: Record<string, unknown> | null;
}

interface SharedRunnerDataValue {
  stepsData: CurrentExecutionStepsResponse | null;
  stepsLoading: boolean;
  orchestratorState: OrchestratorState | null;
  refetchSteps: () => Promise<void>;
}

// =============================================================================
// Context
// =============================================================================

const SharedRunnerDataCtx = createContext<SharedRunnerDataValue | null>(null);

// =============================================================================
// Pure-push orchestrator state hook
// =============================================================================

/**
 * Hook that maintains orchestrator state via a combination of:
 * 1. Initial REST fetch on mount / runId change
 * 2. Pure push updates from WS "orchestrator-state-change" events
 * 3. REST refetch on WS reconnect to ensure consistency
 *
 * This avoids the per-event REST call that useEventTriggeredFetch would make.
 */
function useOrchestratorStatePush(runId: string | null): {
  data: OrchestratorState | null;
} {
  const [state, setState] = useState<OrchestratorState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // REST fetch helper
  const fetchState = useCallback(async () => {
    if (!runId) {
      setState(null);
      return;
    }
    try {
      const data = await runnerFetch<OrchestratorState>(
        `/task-runs/${runId}/orchestrator-state`
      );
      if (mountedRef.current) {
        setState(data ?? null);
      }
    } catch {
      // Silently ignore fetch errors (runner may be offline)
    }
  }, [runId]);

  // Initial fetch + refetch on runId change
  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Subscribe to WS events for pure push updates
  useRunnerEvent(
    "orchestrator-state-change",
    useCallback(
      (payload: unknown) => {
        if (!runId || !mountedRef.current) return;

        const msg = payload as Record<string, unknown> | null;
        if (!msg) return;

        // Handle WS reconnect: refetch full state from REST for consistency
        if (msg.event_type === "__reconnected__") {
          fetchState();
          return;
        }

        // The payload is the serialized AppEvent: { event_type: "OrchestratorStateChange", data: { ... } }
        const eventData = (msg.data ?? msg) as OrchestratorWsEventData;
        if (!eventData.workflow_stage && !eventData.phase) return;

        // Build an OrchestratorState from the WS event data.
        // Spread state_data first (may contain active_agent, activity_type, etc.),
        // then preserve any existing fields from the initial REST fetch that the
        // WS event doesn't overwrite.
        const stateData = (eventData.state_data ?? {}) as Record<
          string,
          unknown
        >;

        setState((prev) => ({
          ...prev,
          ...stateData,
          // Preserve top-level workflow fields from the event (not in state_data)
          ...(eventData.workflow_stage ? { workflow_stage: eventData.workflow_stage } : {}),
          ...(eventData.phase ? { phase: eventData.phase } : {}),
          ...(eventData.iteration != null ? { iteration: eventData.iteration } : {}),
        }));
      },
      [runId, fetchState]
    )
  );

  return { data: state };
}

// =============================================================================
// Provider
// =============================================================================

interface SharedRunnerDataProviderProps {
  /** The selected run ID for orchestrator state. Null disables orchestrator fetch. */
  runId: string | null;
  children: React.ReactNode;
}

/**
 * Provides shared steps data and orchestrator state for the active dashboard.
 * Must be rendered inside RunnerEventProvider.
 *
 * This eliminates duplicate useEventTriggeredFetch hooks across widgets:
 * - /current-execution/steps: was fetched by page + 3 widgets independently
 * - /task-runs/{id}/orchestrator-state: was fetched by 4 components independently
 */
export function SharedRunnerDataProvider({
  runId,
  children,
}: SharedRunnerDataProviderProps) {
  const {
    data: stepsData,
    isLoading: stepsLoading,
    refetch: refetchSteps,
  } = useEventTriggeredFetch<CurrentExecutionStepsResponse>(
    "step-progress",
    "/current-execution/steps"
  );

  const { data: orchestratorState } = useOrchestratorStatePush(runId);

  const value = useMemo(
    () => ({
      stepsData: stepsData ?? null,
      stepsLoading,
      orchestratorState: orchestratorState ?? null,
      refetchSteps,
    }),
    [stepsData, stepsLoading, orchestratorState, refetchSteps]
  );

  return (
    <SharedRunnerDataCtx.Provider value={value}>
      {children}
    </SharedRunnerDataCtx.Provider>
  );
}

// =============================================================================
// Consumer hooks
// =============================================================================

/**
 * Access shared execution steps data.
 * Must be rendered inside SharedRunnerDataProvider.
 */
export function useSharedStepsData() {
  const ctx = useContext(SharedRunnerDataCtx);
  if (!ctx) {
    throw new Error(
      "useSharedStepsData must be used within SharedRunnerDataProvider"
    );
  }
  return {
    data: ctx.stepsData,
    isLoading: ctx.stepsLoading,
    refetch: ctx.refetchSteps,
  };
}

/**
 * Access shared orchestrator state for the selected run.
 * Must be rendered inside SharedRunnerDataProvider.
 */
export function useSharedOrchestratorState() {
  const ctx = useContext(SharedRunnerDataCtx);
  if (!ctx) {
    throw new Error(
      "useSharedOrchestratorState must be used within SharedRunnerDataProvider"
    );
  }
  return { data: ctx.orchestratorState };
}
