import { useCallback, useMemo } from "react";
import { useWorkflowBuilder as useSharedWorkflowBuilder } from "@qontinui/workflow-ui";
import { generateStepId, type WorkflowStage } from "@/types/unified-workflow";

type SharedContext = ReturnType<typeof useSharedWorkflowBuilder>;

export function useStageActions(
  shared: SharedContext,
  currentStageIndex: number | null
) {
  const { state: sharedState, dispatch } = shared;

  const currentStage = useMemo((): WorkflowStage | null => {
    if (currentStageIndex === null) return null;
    return sharedState.workflow.stages?.[currentStageIndex] ?? null;
  }, [currentStageIndex, sharedState.workflow.stages]);

  const addStage = useCallback(
    (name: string) => {
      const newStage: WorkflowStage = {
        id: generateStepId(),
        name,
        description: "",
        setup_steps: [],
        verification_steps: [],
        agentic_steps: [],
        completion_steps: [],
        max_iterations: sharedState.workflow.max_iterations ?? 10,
      };
      dispatch({ type: "ADD_STAGE", stage: newStage });
    },
    [dispatch, sharedState.workflow.max_iterations]
  );

  const removeStage = useCallback(
    (stageIndex: number) => {
      dispatch({ type: "REMOVE_STAGE", stageIndex });
    },
    [dispatch]
  );

  const selectStage = useCallback(
    (stageIndex: number | null) => {
      dispatch({ type: "SET_STAGE_INDEX", index: stageIndex ?? 0 });
    },
    [dispatch]
  );

  const updateStage = useCallback(
    (stageIndex: number, updates: Partial<WorkflowStage>) => {
      dispatch({ type: "UPDATE_STAGE", stageIndex, updates });
    },
    [dispatch]
  );

  const moveStage = useCallback(
    (stageIndex: number, direction: "up" | "down") => {
      const stages = sharedState.workflow.stages;
      if (!stages) return;
      const targetIndex = direction === "up" ? stageIndex - 1 : stageIndex + 1;
      if (targetIndex < 0 || targetIndex >= stages.length) return;

      const newStages = [...stages];
      [newStages[stageIndex], newStages[targetIndex]] = [
        newStages[targetIndex]!,
        newStages[stageIndex]!,
      ];
      dispatch({
        type: "UPDATE_WORKFLOW",
        updates: { stages: newStages },
      });
      dispatch({ type: "SET_STAGE_INDEX", index: targetIndex });
    },
    [dispatch, sharedState.workflow.stages]
  );

  const enableStages = useCallback(() => {
    dispatch({ type: "ENABLE_STAGES" });
  }, [dispatch]);

  const disableStages = useCallback(() => {
    dispatch({ type: "DISABLE_STAGES" });
  }, [dispatch]);

  return {
    currentStage,
    addStage,
    removeStage,
    selectStage,
    updateStage,
    moveStage,
    enableStages,
    disableStages,
  };
}
