import { useCallback } from "react";
import { useWorkflowBuilder as useSharedWorkflowBuilder } from "@qontinui/workflow-ui";
import type {
  UnifiedWorkflow,
  WorkflowExport,
  WorkflowImportResult,
} from "@/types/unified-workflow";
import * as workflowApi from "@/lib/api/unified-workflows";

type SharedContext = ReturnType<typeof useSharedWorkflowBuilder>;

export function useWorkflowApi(
  shared: SharedContext,
  originalWorkflow: UnifiedWorkflow | null,
  setOriginalWorkflow: (w: UnifiedWorkflow | null) => void,
  setIsLoadingState: (loading: boolean) => void,
  setIsSavingState: (saving: boolean) => void,
  setErrorState: (error: string | null) => void
) {
  const { state: sharedState, dispatch } = shared;

  const saveWorkflow =
    useCallback(async (): Promise<UnifiedWorkflow | null> => {
      setIsSavingState(true);
      setErrorState(null);

      try {
        const workflow = sharedState.workflow;
        const isNew = !originalWorkflow || originalWorkflow.id !== workflow.id;

        let saved: UnifiedWorkflow;
        if (isNew) {
          saved = await workflowApi.createWorkflow(workflow);
        } else {
          saved = await workflowApi.updateWorkflow(workflow.id, workflow);
        }

        dispatch({ type: "SET_WORKFLOW", workflow: saved });
        setOriginalWorkflow(saved);
        setIsSavingState(false);
        return saved;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save workflow";
        setErrorState(message);
        setIsSavingState(false);
        return null;
      }
    }, [
      sharedState.workflow,
      originalWorkflow,
      dispatch,
      setOriginalWorkflow,
      setIsSavingState,
      setErrorState,
    ]);

  const loadWorkflow = useCallback(
    async (id: string): Promise<boolean> => {
      setIsLoadingState(true);
      setErrorState(null);

      try {
        const data = await workflowApi.getWorkflow(id);
        dispatch({ type: "SET_WORKFLOW", workflow: data });
        setOriginalWorkflow(data);
        setIsLoadingState(false);
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load workflow";
        setErrorState(message);
        setIsLoadingState(false);
        return false;
      }
    },
    [dispatch, setOriginalWorkflow, setIsLoadingState, setErrorState]
  );

  const exportWorkflow = useCallback(
    async (id: string): Promise<WorkflowExport | null> => {
      setIsLoadingState(true);
      setErrorState(null);

      try {
        const data = await workflowApi.exportWorkflow(id);
        setIsLoadingState(false);
        return data as WorkflowExport;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to export workflow";
        setErrorState(message);
        setIsLoadingState(false);
        return null;
      }
    },
    [setIsLoadingState, setErrorState]
  );

  const importWorkflow = useCallback(
    async (
      workflow: UnifiedWorkflow,
      conflictStrategy: "keep" | "generate" | "overwrite" = "generate"
    ): Promise<WorkflowImportResult | null> => {
      setIsLoadingState(true);
      setErrorState(null);

      try {
        const data = await workflowApi.importWorkflow(workflow);
        setIsLoadingState(false);
        return {
          workflow: data,
          overwritten: conflictStrategy === "overwrite",
          original_id: conflictStrategy === "keep" ? workflow.id : null,
        } as WorkflowImportResult;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to import workflow";
        setErrorState(message);
        setIsLoadingState(false);
        return null;
      }
    },
    [setIsLoadingState, setErrorState]
  );

  return {
    saveWorkflow,
    loadWorkflow,
    exportWorkflow,
    importWorkflow,
  };
}
