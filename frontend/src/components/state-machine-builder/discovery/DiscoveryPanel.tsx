"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  useExtensionStatus,
  useStartExploration,
  useStopExploration,
  useExplorationStatus,
  useExplorationResults,
  useDiscoverStatesFromRenders,
} from "@/lib/runner-api";
import type {
  BuilderState,
  BuilderAction,
  FingerprintDiscoveryResult,
  StartExplorationRequest,
} from "@/lib/state-machine-builder/types";
import { ExplorationConfigForm } from "./ExplorationConfigForm";
import { ExplorationProgress } from "./ExplorationProgress";
import { DiscoveredStateReview } from "./DiscoveredStateReview";

interface DiscoveryPanelProps {
  state: BuilderState;
  dispatch: React.Dispatch<BuilderAction>;
}

type Phase = "config" | "progress" | "review";

function getPhase(state: BuilderState): Phase {
  if (state.pendingStates.length > 0 || state.discoveryResult) {
    return "review";
  }
  if (state.explorationJobId) {
    return "progress";
  }
  return "config";
}

export function DiscoveryPanel({ state, dispatch }: DiscoveryPanelProps) {
  const extensionStatus = useExtensionStatus();
  const startExploration = useStartExploration();
  const stopExploration = useStopExploration();
  const explorationStatus = useExplorationStatus(state.explorationJobId);

  const statusData = explorationStatus.data;
  const isComplete =
    statusData?.status === "complete" ||
    statusData?.status === "error" ||
    statusData?.status === "stopped";

  const explorationResults = useExplorationResults(
    state.explorationJobId,
    isComplete
  );

  const extensionConnected = extensionStatus.data?.connected ?? false;
  const phase = getPhase(state);

  // Track whether we have already dispatched results for the current job
  const resultDispatchedRef = useRef<string | null>(null);

  // When results arrive after exploration completes, dispatch them
  useEffect(() => {
    if (
      explorationResults.data &&
      state.explorationJobId &&
      resultDispatchedRef.current !== state.explorationJobId
    ) {
      resultDispatchedRef.current = state.explorationJobId;

      const discoveryResult = explorationResults.data.state_discovery_result as
        | FingerprintDiscoveryResult
        | undefined;

      if (discoveryResult) {
        dispatch({ type: "SET_DISCOVERY_RESULT", result: discoveryResult });
      }

      // Clear the job id so polling stops
      dispatch({ type: "SET_EXPLORATION_JOB_ID", jobId: null });
    }
  }, [explorationResults.data, state.explorationJobId, dispatch]);

  const handleStart = useCallback(
    async (request: StartExplorationRequest) => {
      try {
        // Clear previous results
        dispatch({ type: "SET_DISCOVERY_RESULT", result: null });
        resultDispatchedRef.current = null;

        const result = await startExploration.mutate(request);
        dispatch({ type: "SET_EXPLORATION_JOB_ID", jobId: result.job_id });
      } catch {
        // Error is available via startExploration.error
      }
    },
    [startExploration, dispatch]
  );

  const handleStop = useCallback(async () => {
    try {
      await stopExploration.mutate({});
    } catch {
      // Error is available via stopExploration.error
    }
  }, [stopExploration]);

  const handleAccept = useCallback(
    (stateId: string) => {
      dispatch({ type: "ACCEPT_DISCOVERED_STATE", stateId });
    },
    [dispatch]
  );

  const handleReject = useCallback(
    (stateId: string) => {
      dispatch({ type: "REJECT_DISCOVERED_STATE", stateId });
    },
    [dispatch]
  );

  const handleAcceptAll = useCallback(() => {
    dispatch({ type: "ACCEPT_ALL" });
  }, [dispatch]);

  const handleSwitchToEdit = useCallback(() => {
    dispatch({ type: "SET_MODE", mode: "edit" });
  }, [dispatch]);

  const discoverFromRenders = useDiscoverStatesFromRenders();

  const handleRediscover = useCallback(async () => {
    try {
      const result = await discoverFromRenders.mutate({ render_logs: [] });
      const discoveryResult = result as FingerprintDiscoveryResult | undefined;
      if (discoveryResult && discoveryResult.states) {
        dispatch({ type: "MERGE_DISCOVERY_RESULT", result: discoveryResult });
        toast.success(
          `Re-discovery found ${discoveryResult.states.length} states`
        );
      } else {
        toast.info("No new states discovered");
      }
    } catch {
      toast.error("Re-discovery failed");
    }
  }, [discoverFromRenders, dispatch]);

  // After all pending states are accepted/rejected and states exist, show edit prompt
  const hasAcceptedStates = state.states.length > 0;
  const allReviewed =
    state.discoveryResult != null && state.pendingStates.length === 0;

  return (
    <div className="space-y-4">
      {phase === "config" && (
        <ExplorationConfigForm
          onStart={handleStart}
          isRunning={startExploration.isLoading}
          extensionConnected={extensionConnected}
        />
      )}

      {phase === "progress" && (
        <ExplorationProgress status={statusData ?? null} onStop={handleStop} />
      )}

      {phase === "review" && (
        <>
          <DiscoveredStateReview
            pendingStates={state.pendingStates}
            onAccept={handleAccept}
            onReject={handleReject}
            onAcceptAll={handleAcceptAll}
          />

          {allReviewed && hasAcceptedStates && (
            <div className="rounded-lg border border-border-subtle bg-surface-raised/50 p-4 text-center space-y-3">
              <p className="text-sm text-text-secondary">
                Review complete.{" "}
                <span className="text-text-primary font-medium">
                  {state.states.length} state
                  {state.states.length !== 1 ? "s" : ""}
                </span>{" "}
                added to the graph.
              </p>
              <Button variant="brand-primary" onClick={handleSwitchToEdit}>
                Switch to Edit Mode
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {allReviewed && !hasAcceptedStates && (
            <div className="rounded-lg border border-border-subtle bg-surface-raised/50 p-4 text-center space-y-3">
              <p className="text-sm text-text-muted">
                All states were rejected. Start a new exploration to discover
                more states.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  dispatch({ type: "SET_DISCOVERY_RESULT", result: null });
                }}
              >
                New Exploration
              </Button>
            </div>
          )}
        </>
      )}

      {/* Re-discover section — shown when accepted states exist */}
      {hasAcceptedStates && phase !== "progress" && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Re-run Discovery
            </h4>
            <p className="text-xs text-text-muted">
              Re-analyze existing render logs to find additional states without
              running a new exploration.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleRediscover}
              disabled={discoverFromRenders.isLoading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-2 ${
                  discoverFromRenders.isLoading ? "animate-spin" : ""
                }`}
              />
              {discoverFromRenders.isLoading
                ? "Discovering..."
                : "Re-run Discovery"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
