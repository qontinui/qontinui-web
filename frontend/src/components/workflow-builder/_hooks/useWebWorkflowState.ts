import { useCallback, useState, useEffect, useMemo } from "react";
import { useWorkflowBuilder as useSharedWorkflowBuilder } from "@qontinui/workflow-ui";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { registerUserSkills } from "@qontinui/workflow-utils";
import { createWebDataAdapter } from "@/lib/web-data-adapter";
import type { WorkflowBuilderState } from "../workflow-builder-types";
import {
  loadOriginalFromStorage,
  saveToStorage,
  saveOriginalToStorage,
} from "../workflow-builder-storage";

type SharedContext = ReturnType<typeof useSharedWorkflowBuilder>;

export function useWebWorkflowState(
  shared: SharedContext,
  initialWorkflow?: UnifiedWorkflow
) {
  const { state: sharedState, dispatch } = shared;

  const [isLoading, setIsLoadingState] = useState(false);
  const [isSaving, setIsSavingState] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [originalWorkflow, setOriginalWorkflow] =
    useState<UnifiedWorkflow | null>(initialWorkflow ?? null);

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized && !initialWorkflow) {
      const storedOriginal = loadOriginalFromStorage();
      if (storedOriginal) {
        setOriginalWorkflow(storedOriginal);
      }
      setInitialized(true);
    }
  }, [initialized, initialWorkflow]);

  useEffect(() => {
    saveToStorage(sharedState.workflow);
  }, [sharedState.workflow]);

  useEffect(() => {
    saveOriginalToStorage(originalWorkflow);
  }, [originalWorkflow]);

  const refreshSkills = useCallback(async () => {
    try {
      const adapter = createWebDataAdapter();
      const skills = (await adapter.fetchSkills?.()) ?? [];
      registerUserSkills(skills);
    } catch {
      // Skills loading is non-critical
    }
  }, []);

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  const webState: WorkflowBuilderState = useMemo(
    () => ({
      workflow: sharedState.workflow,
      originalWorkflow,
      selectedStepId: sharedState.selectedStepId,
      currentStageIndex:
        sharedState.workflow.stages && sharedState.workflow.stages.length > 0
          ? sharedState.currentStageIndex
          : null,
      expandedPhases: sharedState.expandedPhases,
      isLoading,
      isSaving,
      error,
    }),
    [
      sharedState.workflow,
      sharedState.selectedStepId,
      sharedState.currentStageIndex,
      sharedState.expandedPhases,
      originalWorkflow,
      isLoading,
      isSaving,
      error,
    ]
  );

  const setWorkflow = useCallback(
    (workflow: UnifiedWorkflow) => {
      dispatch({ type: "SET_WORKFLOW", workflow });
      dispatch({ type: "SET_ORIGINAL_WORKFLOW", workflow });
      setOriginalWorkflow(workflow);
    },
    [dispatch]
  );

  const updateWorkflow = useCallback(
    (updates: Partial<UnifiedWorkflow>) => {
      dispatch({ type: "UPDATE_WORKFLOW", updates });
    },
    [dispatch]
  );

  const resetToNew = useCallback(() => {
    dispatch({ type: "RESET" });
    setOriginalWorkflow(null);
    setErrorState(null);
  }, [dispatch]);

  const setLoading = useCallback((loading: boolean) => {
    setIsLoadingState(loading);
  }, []);

  const setSaving = useCallback((saving: boolean) => {
    setIsSavingState(saving);
  }, []);

  const setError = useCallback((err: string | null) => {
    setErrorState(err);
  }, []);

  const markSaved = useCallback(() => {
    setOriginalWorkflow(sharedState.workflow);
  }, [sharedState.workflow]);

  return {
    webState,
    originalWorkflow,
    setOriginalWorkflow,
    setIsLoadingState,
    setIsSavingState,
    setErrorState,
    setWorkflow,
    updateWorkflow,
    resetToNew,
    setLoading,
    setSaving,
    setError,
    markSaved,
  };
}
