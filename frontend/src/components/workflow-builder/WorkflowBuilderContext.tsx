"use client";

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from "react";
import {
  WorkflowBuilderProvider as SharedWorkflowBuilderProvider,
  useWorkflowBuilder as useSharedWorkflowBuilder,
} from "@qontinui/workflow-ui";
import {
  createDefaultWorkflow,
  generateStepId,
  type UnifiedStep,
  type UnifiedWorkflow,
  type WorkflowExport,
  type WorkflowFeatures,
  type WorkflowImportResult,
  type WorkflowPhase,
  type WorkflowStage,
} from "@/types/unified-workflow";
import * as workflowApi from "@/lib/api/unified-workflows";

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = "qontinui-web-workflow-builder-draft";
const STORAGE_KEY_ORIGINAL = "qontinui-web-workflow-builder-original";

// =============================================================================
// Web-Specific State Types (extends shared state)
// =============================================================================

interface WorkflowBuilderState {
  workflow: UnifiedWorkflow;
  originalWorkflow: UnifiedWorkflow | null;
  selectedStepId: string | null;
  currentStageIndex: number | null; // null = top-level (single-stage mode)
  expandedPhases: Record<WorkflowPhase, boolean>;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

// =============================================================================
// Context Value Type (web-specific interface for consumers)
// =============================================================================

interface WorkflowBuilderContextValue {
  state: WorkflowBuilderState;
  features: WorkflowFeatures;
  hasUnsavedChanges: boolean;
  isEmpty: boolean;
  setWorkflow: (workflow: UnifiedWorkflow) => void;
  updateWorkflow: (updates: Partial<UnifiedWorkflow>) => void;
  resetToNew: () => void;
  addStep: (step: UnifiedStep, phase: WorkflowPhase) => void;
  removeStep: (stepId: string, phase: WorkflowPhase) => void;
  updateStep: (step: UnifiedStep, phase: WorkflowPhase) => void;
  moveStep: (
    stepId: string,
    phase: WorkflowPhase,
    direction: "up" | "down"
  ) => void;
  reorderSteps: (phase: WorkflowPhase, stepIds: string[]) => void;
  duplicateStep: (stepId: string, phase: WorkflowPhase) => void;
  selectStep: (stepId: string | null) => void;
  getSelectedStep: () => UnifiedStep | null;
  togglePhase: (phase: WorkflowPhase) => void;
  setPhaseExpanded: (phase: WorkflowPhase, expanded: boolean) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  markSaved: () => void;
  saveWorkflow: () => Promise<UnifiedWorkflow | null>;
  loadWorkflow: (id: string) => Promise<boolean>;
  exportWorkflow: (id: string) => Promise<WorkflowExport | null>;
  importWorkflow: (
    workflow: UnifiedWorkflow,
    conflictStrategy?: "keep" | "generate" | "overwrite"
  ) => Promise<WorkflowImportResult | null>;
  currentStageIndex: number | null;
  currentStage: WorkflowStage | null;
  addStage: (name: string) => void;
  removeStage: (stageIndex: number) => void;
  selectStage: (stageIndex: number | null) => void;
  updateStage: (stageIndex: number, updates: Partial<WorkflowStage>) => void;
  moveStage: (stageIndex: number, direction: "up" | "down") => void;
  enableStages: () => void;
  disableStages: () => void;
  getActiveSteps: (phase: WorkflowPhase) => UnifiedStep[];
}

// =============================================================================
// Context
// =============================================================================

const WorkflowBuilderContext =
  createContext<WorkflowBuilderContextValue | null>(null);

// =============================================================================
// LocalStorage Helpers
// =============================================================================

function loadFromStorage(): UnifiedWorkflow | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && "setup_steps" in parsed) {
        return parsed as UnifiedWorkflow;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function loadOriginalFromStorage(): UnifiedWorkflow | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ORIGINAL);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object" && "setup_steps" in parsed) {
        return parsed as UnifiedWorkflow;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function saveToStorage(workflow: UnifiedWorkflow): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflow));
  } catch {
    // ignore
  }
}

function saveOriginalToStorage(workflow: UnifiedWorkflow | null): void {
  try {
    if (workflow) {
      localStorage.setItem(STORAGE_KEY_ORIGINAL, JSON.stringify(workflow));
    } else {
      localStorage.removeItem(STORAGE_KEY_ORIGINAL);
    }
  } catch {
    // ignore
  }
}

// =============================================================================
// Inner Provider (uses shared context, adds web-specific features)
// =============================================================================

function WebWorkflowBuilderInner({
  children,
  initialWorkflow,
}: {
  children: React.ReactNode;
  initialWorkflow?: UnifiedWorkflow;
}) {
  const shared = useSharedWorkflowBuilder();
  const { state: sharedState, dispatch } = shared;

  // -------------------------------------------------------------------------
  // Web-specific state: loading, saving, error, originalWorkflow
  // -------------------------------------------------------------------------
  const [isLoading, setIsLoadingState] = useState(false);
  const [isSaving, setIsSavingState] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [originalWorkflow, setOriginalWorkflow] =
    useState<UnifiedWorkflow | null>(initialWorkflow ?? null);

  // Initialize originalWorkflow from storage on mount
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

  // Persist workflow to localStorage
  useEffect(() => {
    saveToStorage(sharedState.workflow);
  }, [sharedState.workflow]);

  // Persist original workflow to localStorage
  useEffect(() => {
    saveOriginalToStorage(originalWorkflow);
  }, [originalWorkflow]);

  // -------------------------------------------------------------------------
  // Compose the web-specific WorkflowBuilderState from shared state
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Action dispatchers mapped to shared provider actions
  // -------------------------------------------------------------------------
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
      // The shared provider expects steps as UnifiedStep[], so we need to
      // reconstruct the ordered array from IDs using the current steps.
      const currentSteps = shared.currentPhaseSteps(phase);
      const stepMap = new Map(currentSteps.map((s) => [s.id, s]));
      const reordered: UnifiedStep[] = [];
      for (const id of stepIds) {
        const step = stepMap.get(id);
        if (step) reordered.push(step);
      }
      // Append any not in stepIds (e.g., summary step)
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
    return shared.selectedStep;
  }, [shared.selectedStep]);

  const togglePhase = useCallback(
    (phase: WorkflowPhase) => {
      dispatch({ type: "TOGGLE_PHASE", phase });
    },
    [dispatch]
  );

  const setPhaseExpanded = useCallback(
    (phase: WorkflowPhase, expanded: boolean) => {
      // The shared provider doesn't have a SET_PHASE_EXPANDED action,
      // but TOGGLE_PHASE toggles. We need to check and toggle only if needed.
      if (sharedState.expandedPhases[phase] !== expanded) {
        dispatch({ type: "TOGGLE_PHASE", phase });
      }
    },
    [dispatch, sharedState.expandedPhases]
  );

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

  // -------------------------------------------------------------------------
  // Stage management
  // -------------------------------------------------------------------------
  const currentStageIndex = webState.currentStageIndex;

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
      // The shared provider doesn't have a MOVE_STAGE action, so we
      // implement it using UPDATE_STAGE by swapping adjacent stages.
      const stages = sharedState.workflow.stages;
      if (!stages) return;
      const targetIndex = direction === "up" ? stageIndex - 1 : stageIndex + 1;
      if (targetIndex < 0 || targetIndex >= stages.length) return;

      // Swap stages: update the workflow with the new stages array
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

  const getActiveSteps = useCallback(
    (phase: WorkflowPhase): UnifiedStep[] => {
      return shared.currentPhaseSteps(phase);
    },
    [shared]
  );

  // -------------------------------------------------------------------------
  // API operations (web-specific)
  // -------------------------------------------------------------------------
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
    }, [sharedState.workflow, originalWorkflow, dispatch]);

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
    [dispatch]
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
    []
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
    []
  );

  // -------------------------------------------------------------------------
  // Compose final context value
  // -------------------------------------------------------------------------
  const value: WorkflowBuilderContextValue = useMemo(
    () => ({
      state: webState,
      features: shared.features,
      hasUnsavedChanges:
        shared.hasUnsavedChanges ||
        (originalWorkflow === null && webState.workflow.name !== ""),
      isEmpty: shared.isEmpty,
      setWorkflow,
      updateWorkflow,
      resetToNew,
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
      setLoading,
      setSaving,
      setError,
      markSaved,
      saveWorkflow,
      loadWorkflow,
      exportWorkflow,
      importWorkflow,
      currentStageIndex,
      currentStage,
      addStage,
      removeStage,
      selectStage,
      updateStage,
      moveStage,
      enableStages,
      disableStages,
      getActiveSteps,
    }),
    [
      webState,
      shared.features,
      shared.hasUnsavedChanges,
      shared.isEmpty,
      originalWorkflow,
      setWorkflow,
      updateWorkflow,
      resetToNew,
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
      setLoading,
      setSaving,
      setError,
      markSaved,
      saveWorkflow,
      loadWorkflow,
      exportWorkflow,
      importWorkflow,
      currentStageIndex,
      currentStage,
      addStage,
      removeStage,
      selectStage,
      updateStage,
      moveStage,
      enableStages,
      disableStages,
      getActiveSteps,
    ]
  );

  return (
    <WorkflowBuilderContext.Provider value={value}>
      {children}
    </WorkflowBuilderContext.Provider>
  );
}

// =============================================================================
// Provider (public API - wraps shared provider + web-specific layer)
// =============================================================================

interface WorkflowBuilderProviderProps {
  children: React.ReactNode;
  initialWorkflow?: UnifiedWorkflow;
}

export function WorkflowBuilderProvider({
  children,
  initialWorkflow,
}: WorkflowBuilderProviderProps) {
  // Resolve initial workflow: explicit prop > localStorage > default
  const storedWorkflow = !initialWorkflow ? loadFromStorage() : null;
  const resolvedInitial = initialWorkflow ??
    storedWorkflow ?? {
      ...createDefaultWorkflow(),
      id: generateStepId(),
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    };

  return (
    <SharedWorkflowBuilderProvider initialWorkflow={resolvedInitial}>
      <WebWorkflowBuilderInner initialWorkflow={initialWorkflow}>
        {children}
      </WebWorkflowBuilderInner>
    </SharedWorkflowBuilderProvider>
  );
}

// =============================================================================
// Hook (public API - unchanged interface for consumers)
// =============================================================================

export function useWorkflowBuilder(): WorkflowBuilderContextValue {
  const context = useContext(WorkflowBuilderContext);
  if (!context) {
    throw new Error(
      "useWorkflowBuilder must be used within a WorkflowBuilderProvider"
    );
  }
  return context;
}
