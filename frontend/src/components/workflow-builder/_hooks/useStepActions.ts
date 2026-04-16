import { useCallback } from "react";
import { useWorkflowBuilder as useSharedWorkflowBuilder } from "@qontinui/workflow-ui";
import {
  generateStepId,
  type UnifiedStep,
  type WorkflowPhase,
} from "@/types/unified-workflow";

type SharedContext = ReturnType<typeof useSharedWorkflowBuilder>;

export function useStepActions(shared: SharedContext) {
  const { state: sharedState, dispatch } = shared;

  const addStep = useCallback(
    (step: UnifiedStep, phase: WorkflowPhase) => {
      const stepWithId = { ...step, id: step.id || generateStepId() };
      dispatch({ type: "ADD_STEP", step: stepWithId, phase });
    },
    [dispatch]
  );

  const removeStep = useCallback(
    (stepId: string, phase: WorkflowPhase) => {
      dispatch({ type: "REMOVE_STEP", stepId, phase });
    },
    [dispatch]
  );

  const updateStep = useCallback(
    (step: UnifiedStep, _phase: WorkflowPhase) => {
      dispatch({ type: "UPDATE_STEP", stepId: step.id, updates: step });
    },
    [dispatch]
  );

  const moveStep = useCallback(
    (stepId: string, phase: WorkflowPhase, direction: "up" | "down") => {
      dispatch({ type: "MOVE_STEP", stepId, phase, direction });
    },
    [dispatch]
  );

  const reorderSteps = useCallback(
    (phase: WorkflowPhase, stepIds: string[]) => {
      // shared.currentPhaseSteps returns wire-side UnifiedStep (open `Other`
      // variant); narrow to the web's strict view (= CanonicalStep) since
      // builder-managed workflows only contain canonical step shapes.
      const currentSteps = shared.currentPhaseSteps(phase) as UnifiedStep[];
      const stepMap = new Map(currentSteps.map((s) => [s.id, s]));
      const reordered: UnifiedStep[] = [];
      for (const id of stepIds) {
        const step = stepMap.get(id as string);
        if (step) reordered.push(step);
      }
      for (const step of currentSteps) {
        if (!stepIds.includes(step.id)) reordered.push(step);
      }
      dispatch({ type: "REORDER_STEPS", phase, steps: reordered });
    },
    [dispatch, shared]
  );

  const duplicateStep = useCallback(
    (stepId: string, phase: WorkflowPhase) => {
      dispatch({ type: "DUPLICATE_STEP", stepId, phase });
    },
    [dispatch]
  );

  const selectStep = useCallback(
    (stepId: string | null) => {
      dispatch({ type: "SELECT_STEP", stepId });
    },
    [dispatch]
  );

  const getSelectedStep = useCallback((): UnifiedStep | null => {
    // shared.selectedStep is wire-side (open `Other` variant); narrow to
    // the web's strict view since builder-managed steps are canonical.
    return (shared.selectedStep ?? null) as UnifiedStep | null;
  }, [shared.selectedStep]);

  const togglePhase = useCallback(
    (phase: WorkflowPhase) => {
      dispatch({ type: "TOGGLE_PHASE", phase });
    },
    [dispatch]
  );

  const setPhaseExpanded = useCallback(
    (phase: WorkflowPhase, expanded: boolean) => {
      if (sharedState.expandedPhases[phase] !== expanded) {
        dispatch({ type: "TOGGLE_PHASE", phase });
      }
    },
    [dispatch, sharedState.expandedPhases]
  );

  const getActiveSteps = useCallback(
    (phase: WorkflowPhase): UnifiedStep[] => {
      // shared.currentPhaseSteps returns wire-side UnifiedStep[] (open
      // `Other` variant); narrow to web's strict view since the builder
      // only produces canonical step shapes.
      return shared.currentPhaseSteps(phase) as UnifiedStep[];
    },
    [shared]
  );

  return {
    addStep,
    removeStep,
    updateStep,
    moveStep,
    reorderSteps,
    duplicateStep,
    selectStep,
    getSelectedStep,
    togglePhase,
    setPhaseExpanded,
    getActiveSteps,
  };
}
