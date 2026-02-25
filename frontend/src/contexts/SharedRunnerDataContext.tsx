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
  plan_phase_name?: string;
  plan_phase_index?: number;
  plan_total_phases?: number;
  workflow_stage?: string;
  phase?: string;
  iteration?: number;
  max_iterations?: number;
  /** Multi-stage workflow fields */
  stage_index?: number;
  total_stages?: number;
  stage_name?: string;
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
 * Extract stage-related fields from the Rust state_data JSON.
 * The state_data contains the serialized state enum, e.g.:
 * { "VerificationRunning": { "iteration": 1, "stage_index": 2 } }
 */
function extractStateDataFields(
  stateData: Record<string, unknown>
): Partial<OrchestratorState> {
  const result: Partial<OrchestratorState> = {};
  if (typeof stateData.stage_index === "number")
    result.stage_index = stateData.stage_index;
  if (typeof stateData.total_stages === "number")
    result.total_stages = stateData.total_stages;
  if (typeof stateData.phase_name === "string")
    result.plan_phase_name = stateData.phase_name;
  if (typeof stateData.phase_index === "number")
    result.plan_phase_index = stateData.phase_index;
  return result;
}

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

  // REST fetch helper — the /orchestrator-state endpoint returns WorkflowStateResponse
  // which includes plan_phase_name, plan_phase_index, plan_total_phases, stage_index, etc.
  const fetchState = useCallback(async () => {
    if (!runId) {
      setState(null);
      return;
    }
    try {
      const data = await runnerFetch<Record<string, unknown>>(
        `/task-runs/${runId}/orchestrator-state`
      );
      if (mountedRef.current && data) {
        // Map WorkflowStateResponse fields to OrchestratorState
        const orchState: OrchestratorState = {
          workflow_stage: data.workflow_stage as string | undefined,
          phase: data.phase as string | undefined,
          iteration: data.iteration as number | undefined,
          max_iterations: data.max_iterations as number | undefined,
          is_paused: data.is_paused as boolean | undefined,
          plan_phase: data.plan_phase_name as string | undefined,
          plan_phase_name: data.plan_phase_name as string | undefined,
          plan_phase_index: data.plan_phase_index as number | undefined,
          plan_total_phases: data.plan_total_phases as number | undefined,
          stage_index: data.stage_index as number | undefined,
          total_stages: data.total_stages as number | undefined,
          // Extract from state_data if top-level fields aren't set
          ...(data.state_data
            ? extractStateDataFields(data.state_data as Record<string, unknown>)
            : {}),
        };
        setState(orchState);
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
        if (eventData.task_run_id && eventData.task_run_id !== runId) return;
        if (!eventData.workflow_stage && !eventData.phase) return;

        // Build an OrchestratorState from the WS event data.
        // Spread state_data first (may contain active_agent, activity_type, etc.),
        // then preserve any existing fields from the initial REST fetch that the
        // WS event doesn't overwrite.
        const stateData = (eventData.state_data ?? {}) as Record<
          string,
          unknown
        >;

        // Extract stage-related fields from state_data
        const stageFields = extractStateDataFields(stateData);

        setState((prev) => ({
          ...prev,
          ...stageFields,
          // Preserve top-level workflow fields from the event (not in state_data)
          ...(eventData.workflow_stage
            ? { workflow_stage: eventData.workflow_stage }
            : {}),
          ...(eventData.phase ? { phase: eventData.phase } : {}),
          ...(eventData.iteration != null
            ? { iteration: eventData.iteration }
            : {}),
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
 * - /current-execution/batch: single endpoint for all step data + metadata
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
    "/current-execution/batch"
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
