import { useMemo, useCallback } from "react";
import type {
  UIBridgeRawResults,
  SuggestedTransition,
} from "@/hooks/useUIBridgeExploration";
import { buildTransitionsFromSteps } from "@/lib/ui-bridge/transition-builder";

export function useUIBridgeTransitions(
  results: UIBridgeRawResults | null | undefined,
  onAcceptTransition?: (transition: SuggestedTransition) => void,
  onAcceptAllTransitions?: (transitions: SuggestedTransition[]) => void
) {
  const transitionBuildResult = useMemo(() => {
    if (!results?.steps?.length) {
      return { transitions: [], stateHashes: new Map(), unmappedSteps: [] };
    }
    return buildTransitionsFromSteps(
      results.steps,
      results.state_discovery?.states
    );
  }, [results?.steps, results?.state_discovery?.states]);

  const suggestedTransitions = transitionBuildResult.transitions;

  const hasEnhancedStepData = useMemo(() => {
    if (!results?.steps?.length) return false;
    const firstStep = results.steps[0];
    return (
      firstStep?.action_result !== undefined ||
      firstStep?.snapshot_before_hash !== undefined
    );
  }, [results?.steps]);

  const handleAcceptTransition = useCallback(
    (transition: SuggestedTransition) => {
      onAcceptTransition?.(transition);
    },
    [onAcceptTransition]
  );

  const handleAcceptAllTransitions = useCallback(
    (transitions: SuggestedTransition[]) => {
      onAcceptAllTransitions?.(transitions);
    },
    [onAcceptAllTransitions]
  );

  return {
    suggestedTransitions,
    hasEnhancedStepData,
    handleAcceptTransition,
    handleAcceptAllTransitions,
  };
}
