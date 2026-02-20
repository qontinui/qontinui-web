"use client";

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import type {
  UnifiedWorkflow,
  UnifiedStep,
  SetupStep,
  VerificationStep,
  AgenticStep,
  CompletionStep,
  WorkflowPhase,
  WorkflowFeatures,
  WorkflowExport,
  WorkflowImportResult,
  PromptStep,
} from "@/types/unified-workflow";
import {
  detectWorkflowFeatures,
  generateStepId,
  createDefaultWorkflow,
  isWorkflowEmpty,
} from "@/types/unified-workflow";
import * as workflowApi from "@/lib/api/unified-workflows";

// =============================================================================
// Constants
// =============================================================================

const STORAGE_KEY = "qontinui-web-workflow-builder-draft";
const STORAGE_KEY_ORIGINAL = "qontinui-web-workflow-builder-original";

// =============================================================================
// State Types
// =============================================================================

interface WorkflowBuilderState {
  workflow: UnifiedWorkflow;
  originalWorkflow: UnifiedWorkflow | null;
  selectedStepId: string | null;
  expandedPhases: Record<WorkflowPhase, boolean>;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

// =============================================================================
// Actions
// =============================================================================

type WorkflowBuilderAction =
  | { type: "SET_WORKFLOW"; payload: UnifiedWorkflow }
  | { type: "UPDATE_WORKFLOW"; payload: Partial<UnifiedWorkflow> }
  | { type: "ADD_STEP"; payload: { step: UnifiedStep; phase: WorkflowPhase } }
  | { type: "REMOVE_STEP"; payload: { stepId: string; phase: WorkflowPhase } }
  | {
      type: "UPDATE_STEP";
      payload: { step: UnifiedStep; phase: WorkflowPhase };
    }
  | {
      type: "MOVE_STEP";
      payload: {
        stepId: string;
        phase: WorkflowPhase;
        direction: "up" | "down";
      };
    }
  | {
      type: "REORDER_STEPS";
      payload: { phase: WorkflowPhase; stepIds: string[] };
    }
  | {
      type: "DUPLICATE_STEP";
      payload: { stepId: string; phase: WorkflowPhase };
    }
  | { type: "SELECT_STEP"; payload: string | null }
  | { type: "TOGGLE_PHASE"; payload: WorkflowPhase }
  | {
      type: "SET_PHASE_EXPANDED";
      payload: { phase: WorkflowPhase; expanded: boolean };
    }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_SAVING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "RESET_TO_NEW" }
  | { type: "MARK_SAVED" };

// =============================================================================
// Reducer
// =============================================================================

function workflowBuilderReducer(
  state: WorkflowBuilderState,
  action: WorkflowBuilderAction,
): WorkflowBuilderState {
  switch (action.type) {
    case "SET_WORKFLOW":
      return {
        ...state,
        workflow: action.payload,
        originalWorkflow: action.payload,
        selectedStepId: null,
      };

    case "UPDATE_WORKFLOW":
      return {
        ...state,
        workflow: { ...state.workflow, ...action.payload },
      };

    case "ADD_STEP": {
      const { step, phase } = action.payload;
      const stepWithId = { ...step, id: step.id || generateStepId() };

      const allStepIds = new Set([
        ...state.workflow.setup_steps.map((s) => s.id),
        ...state.workflow.verification_steps.map((s) => s.id),
        ...state.workflow.agentic_steps.map((s) => s.id),
        ...(state.workflow.completion_steps ?? []).map((s) => s.id),
      ]);

      if (allStepIds.has(stepWithId.id)) {
        return state;
      }

      switch (phase) {
        case "setup":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              setup_steps: [
                ...state.workflow.setup_steps,
                stepWithId as SetupStep,
              ],
            },
            selectedStepId: stepWithId.id,
            expandedPhases: { ...state.expandedPhases, setup: true },
          };
        case "verification":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              verification_steps: [
                ...state.workflow.verification_steps,
                stepWithId as VerificationStep,
              ],
            },
            selectedStepId: stepWithId.id,
            expandedPhases: { ...state.expandedPhases, verification: true },
          };
        case "agentic":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              agentic_steps: [
                ...state.workflow.agentic_steps,
                stepWithId as AgenticStep,
              ],
            },
            selectedStepId: stepWithId.id,
            expandedPhases: { ...state.expandedPhases, agentic: true },
          };
        case "completion": {
          const existingSteps = state.workflow.completion_steps ?? [];
          const summaryIndex = existingSteps.findIndex(
            (s) =>
              s.type === "prompt" && (s as PromptStep).is_summary_step === true,
          );

          let newSteps: CompletionStep[];
          if (summaryIndex >= 0) {
            newSteps = [
              ...existingSteps.slice(0, summaryIndex),
              stepWithId as CompletionStep,
              ...existingSteps.slice(summaryIndex),
            ];
          } else {
            newSteps = [...existingSteps, stepWithId as CompletionStep];
          }

          return {
            ...state,
            workflow: { ...state.workflow, completion_steps: newSteps },
            selectedStepId: stepWithId.id,
            expandedPhases: { ...state.expandedPhases, completion: true },
          };
        }
        default:
          return state;
      }
    }

    case "REMOVE_STEP": {
      const { stepId, phase } = action.payload;
      const clearSelection =
        state.selectedStepId === stepId ? null : state.selectedStepId;

      switch (phase) {
        case "setup":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              setup_steps: state.workflow.setup_steps.filter(
                (s) => s.id !== stepId,
              ),
            },
            selectedStepId: clearSelection,
          };
        case "verification":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              verification_steps: state.workflow.verification_steps.filter(
                (s) => s.id !== stepId,
              ),
            },
            selectedStepId: clearSelection,
          };
        case "agentic":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              agentic_steps: state.workflow.agentic_steps.filter(
                (s) => s.id !== stepId,
              ),
            },
            selectedStepId: clearSelection,
          };
        case "completion":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              completion_steps: (state.workflow.completion_steps ?? []).filter(
                (s) => s.id !== stepId,
              ),
            },
            selectedStepId: clearSelection,
          };
        default:
          return state;
      }
    }

    case "UPDATE_STEP": {
      const { step, phase } = action.payload;

      switch (phase) {
        case "setup":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              setup_steps: state.workflow.setup_steps.map((s) =>
                s.id === step.id ? (step as SetupStep) : s,
              ),
            },
          };
        case "verification":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              verification_steps: state.workflow.verification_steps.map((s) =>
                s.id === step.id ? (step as VerificationStep) : s,
              ),
            },
          };
        case "agentic":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              agentic_steps: state.workflow.agentic_steps.map((s) =>
                s.id === step.id ? (step as AgenticStep) : s,
              ),
            },
          };
        case "completion":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              completion_steps: (state.workflow.completion_steps ?? []).map(
                (s) => (s.id === step.id ? (step as CompletionStep) : s),
              ),
            },
          };
        default:
          return state;
      }
    }

    case "MOVE_STEP": {
      const { stepId, phase, direction } = action.payload;

      const moveInArray = <T extends { id: string }>(arr: T[]): T[] => {
        const index = arr.findIndex((s) => s.id === stepId);
        if (index === -1) return arr;
        if (direction === "up" && index === 0) return arr;
        if (direction === "down" && index === arr.length - 1) return arr;

        const newArr = [...arr];
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        [newArr[index], newArr[targetIndex]] = [
          newArr[targetIndex]!,
          newArr[index]!,
        ];
        return newArr;
      };

      if (phase === "completion") {
        const steps = state.workflow.completion_steps ?? [];
        const stepToMove = steps.find((s) => s.id === stepId);
        if (
          stepToMove &&
          stepToMove.type === "prompt" &&
          (stepToMove as PromptStep).is_summary_step
        ) {
          return state;
        }
        if (direction === "down") {
          const index = steps.findIndex((s) => s.id === stepId);
          const nextStep = steps[index + 1];
          if (
            nextStep &&
            nextStep.type === "prompt" &&
            (nextStep as PromptStep).is_summary_step
          ) {
            return state;
          }
        }
      }

      switch (phase) {
        case "setup":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              setup_steps: moveInArray(state.workflow.setup_steps),
            },
          };
        case "verification":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              verification_steps: moveInArray(
                state.workflow.verification_steps,
              ),
            },
          };
        case "agentic":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              agentic_steps: moveInArray(state.workflow.agentic_steps),
            },
          };
        case "completion":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              completion_steps: moveInArray(
                state.workflow.completion_steps ?? [],
              ),
            },
          };
        default:
          return state;
      }
    }

    case "REORDER_STEPS": {
      const { phase: reorderPhase, stepIds } = action.payload;

      const reorderArray = <T extends { id: string }>(arr: T[]): T[] => {
        const map = new Map(arr.map((s) => [s.id, s]));
        const reordered: T[] = [];
        for (const id of stepIds) {
          const item = map.get(id);
          if (item) reordered.push(item);
        }
        // Append any items not in stepIds (e.g. summary step)
        for (const item of arr) {
          if (!stepIds.includes(item.id)) reordered.push(item);
        }
        return reordered;
      };

      switch (reorderPhase) {
        case "setup":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              setup_steps: reorderArray(state.workflow.setup_steps),
            },
          };
        case "verification":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              verification_steps: reorderArray(
                state.workflow.verification_steps,
              ),
            },
          };
        case "agentic":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              agentic_steps: reorderArray(state.workflow.agentic_steps),
            },
          };
        case "completion":
          return {
            ...state,
            workflow: {
              ...state.workflow,
              completion_steps: reorderArray(
                state.workflow.completion_steps ?? [],
              ),
            },
          };
        default:
          return state;
      }
    }

    case "DUPLICATE_STEP": {
      const { stepId: dupStepId, phase: dupPhase } = action.payload;

      const duplicateInArray = <T extends { id: string; name: string }>(
        arr: T[],
      ): { arr: T[]; newId: string | null } => {
        const index = arr.findIndex((s) => s.id === dupStepId);
        if (index === -1) return { arr, newId: null };
        const original = arr[index]!;
        const newId = generateStepId();
        const clone = {
          ...JSON.parse(JSON.stringify(original)),
          id: newId,
          name: `${original.name} (copy)`,
        } as T;
        const newArr = [...arr];
        newArr.splice(index + 1, 0, clone);
        return { arr: newArr, newId };
      };

      switch (dupPhase) {
        case "setup": {
          const { arr, newId } = duplicateInArray(state.workflow.setup_steps);
          return {
            ...state,
            workflow: { ...state.workflow, setup_steps: arr },
            selectedStepId: newId ?? state.selectedStepId,
          };
        }
        case "verification": {
          const { arr, newId } = duplicateInArray(
            state.workflow.verification_steps,
          );
          return {
            ...state,
            workflow: { ...state.workflow, verification_steps: arr },
            selectedStepId: newId ?? state.selectedStepId,
          };
        }
        case "agentic": {
          const { arr, newId } = duplicateInArray(state.workflow.agentic_steps);
          return {
            ...state,
            workflow: { ...state.workflow, agentic_steps: arr },
            selectedStepId: newId ?? state.selectedStepId,
          };
        }
        case "completion": {
          const { arr, newId } = duplicateInArray(
            state.workflow.completion_steps ?? [],
          );
          return {
            ...state,
            workflow: { ...state.workflow, completion_steps: arr },
            selectedStepId: newId ?? state.selectedStepId,
          };
        }
        default:
          return state;
      }
    }

    case "SELECT_STEP":
      return { ...state, selectedStepId: action.payload };

    case "TOGGLE_PHASE":
      return {
        ...state,
        expandedPhases: {
          ...state.expandedPhases,
          [action.payload]: !state.expandedPhases[action.payload],
        },
      };

    case "SET_PHASE_EXPANDED":
      return {
        ...state,
        expandedPhases: {
          ...state.expandedPhases,
          [action.payload.phase]: action.payload.expanded,
        },
      };

    case "SET_LOADING":
      return { ...state, isLoading: action.payload };

    case "SET_SAVING":
      return { ...state, isSaving: action.payload };

    case "SET_ERROR":
      return { ...state, error: action.payload };

    case "RESET_TO_NEW": {
      const emptyWorkflow: UnifiedWorkflow = {
        ...createDefaultWorkflow(),
        id: generateStepId(),
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
      };
      return {
        ...state,
        workflow: emptyWorkflow,
        originalWorkflow: null,
        selectedStepId: null,
        error: null,
      };
    }

    case "MARK_SAVED":
      return { ...state, originalWorkflow: state.workflow };

    default:
      return state;
  }
}

// =============================================================================
// Context Value Type
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
    direction: "up" | "down",
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
    conflictStrategy?: "keep" | "generate" | "overwrite",
  ) => Promise<WorkflowImportResult | null>;
}

// =============================================================================
// Context
// =============================================================================

const WorkflowBuilderContext =
  createContext<WorkflowBuilderContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface WorkflowBuilderProviderProps {
  children: React.ReactNode;
  initialWorkflow?: UnifiedWorkflow;
}

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

export function WorkflowBuilderProvider({
  children,
  initialWorkflow,
}: WorkflowBuilderProviderProps) {
  const storedWorkflow = !initialWorkflow ? loadFromStorage() : null;
  const storedOriginalWorkflow = !initialWorkflow
    ? loadOriginalFromStorage()
    : null;

  const emptyWorkflow: UnifiedWorkflow = {
    ...createDefaultWorkflow(),
    id: generateStepId(),
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
  };

  const initialState: WorkflowBuilderState = {
    workflow: initialWorkflow ?? storedWorkflow ?? emptyWorkflow,
    originalWorkflow: initialWorkflow ?? storedOriginalWorkflow ?? null,
    selectedStepId: null,
    expandedPhases: {
      setup: true,
      verification: true,
      agentic: true,
      completion: true,
    },
    isLoading: false,
    isSaving: false,
    error: null,
  };

  const [state, dispatch] = useReducer(workflowBuilderReducer, initialState);

  useEffect(() => {
    saveToStorage(state.workflow);
  }, [state.workflow]);
  useEffect(() => {
    saveOriginalToStorage(state.originalWorkflow);
  }, [state.originalWorkflow]);

  const features = useMemo(
    () => detectWorkflowFeatures(state.workflow),
    [state.workflow],
  );

  const hasUnsavedChanges = useMemo(() => {
    if (!state.originalWorkflow) {
      return !isWorkflowEmpty(state.workflow) || state.workflow.name !== "";
    }
    return (
      JSON.stringify(state.workflow) !== JSON.stringify(state.originalWorkflow)
    );
  }, [state.workflow, state.originalWorkflow]);

  const isEmpty = useMemo(
    () => isWorkflowEmpty(state.workflow),
    [state.workflow],
  );

  const setWorkflow = useCallback((workflow: UnifiedWorkflow) => {
    dispatch({ type: "SET_WORKFLOW", payload: workflow });
  }, []);

  const updateWorkflow = useCallback((updates: Partial<UnifiedWorkflow>) => {
    dispatch({ type: "UPDATE_WORKFLOW", payload: updates });
  }, []);

  const resetToNew = useCallback(() => {
    dispatch({ type: "RESET_TO_NEW" });
  }, []);

  const addStep = useCallback((step: UnifiedStep, phase: WorkflowPhase) => {
    dispatch({ type: "ADD_STEP", payload: { step, phase } });
  }, []);

  const removeStep = useCallback((stepId: string, phase: WorkflowPhase) => {
    dispatch({ type: "REMOVE_STEP", payload: { stepId, phase } });
  }, []);

  const updateStep = useCallback((step: UnifiedStep, phase: WorkflowPhase) => {
    dispatch({ type: "UPDATE_STEP", payload: { step, phase } });
  }, []);

  const moveStep = useCallback(
    (stepId: string, phase: WorkflowPhase, direction: "up" | "down") => {
      dispatch({ type: "MOVE_STEP", payload: { stepId, phase, direction } });
    },
    [],
  );

  const reorderSteps = useCallback(
    (phase: WorkflowPhase, stepIds: string[]) => {
      dispatch({ type: "REORDER_STEPS", payload: { phase, stepIds } });
    },
    [],
  );

  const duplicateStep = useCallback((stepId: string, phase: WorkflowPhase) => {
    dispatch({ type: "DUPLICATE_STEP", payload: { stepId, phase } });
  }, []);

  const selectStep = useCallback((stepId: string | null) => {
    dispatch({ type: "SELECT_STEP", payload: stepId });
  }, []);

  const getSelectedStep = useCallback((): UnifiedStep | null => {
    if (!state.selectedStepId) return null;
    for (const step of state.workflow.setup_steps) {
      if (step.id === state.selectedStepId) return step;
    }
    for (const step of state.workflow.verification_steps) {
      if (step.id === state.selectedStepId) return step;
    }
    for (const step of state.workflow.agentic_steps) {
      if (step.id === state.selectedStepId) return step;
    }
    for (const step of state.workflow.completion_steps ?? []) {
      if (step.id === state.selectedStepId) return step;
    }
    return null;
  }, [state.selectedStepId, state.workflow]);

  const togglePhase = useCallback((phase: WorkflowPhase) => {
    dispatch({ type: "TOGGLE_PHASE", payload: phase });
  }, []);

  const setPhaseExpanded = useCallback(
    (phase: WorkflowPhase, expanded: boolean) => {
      dispatch({ type: "SET_PHASE_EXPANDED", payload: { phase, expanded } });
    },
    [],
  );

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: "SET_LOADING", payload: loading });
  }, []);

  const setSaving = useCallback((saving: boolean) => {
    dispatch({ type: "SET_SAVING", payload: saving });
  }, []);

  const setError = useCallback((error: string | null) => {
    dispatch({ type: "SET_ERROR", payload: error });
  }, []);

  const markSaved = useCallback(() => {
    dispatch({ type: "MARK_SAVED" });
  }, []);

  const saveWorkflow =
    useCallback(async (): Promise<UnifiedWorkflow | null> => {
      dispatch({ type: "SET_SAVING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const workflow = state.workflow;
        const isNew =
          !state.originalWorkflow || state.originalWorkflow.id !== workflow.id;

        let saved: UnifiedWorkflow;
        if (isNew) {
          saved = await workflowApi.createWorkflow(workflow);
        } else {
          saved = await workflowApi.updateWorkflow(workflow.id, workflow);
        }

        dispatch({ type: "SET_WORKFLOW", payload: saved });
        dispatch({ type: "SET_SAVING", payload: false });
        return saved;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save workflow";
        dispatch({ type: "SET_ERROR", payload: message });
        dispatch({ type: "SET_SAVING", payload: false });
        return null;
      }
    }, [state.workflow, state.originalWorkflow]);

  const loadWorkflow = useCallback(async (id: string): Promise<boolean> => {
    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });

    try {
      const data = await workflowApi.getWorkflow(id);
      dispatch({ type: "SET_WORKFLOW", payload: data });
      dispatch({ type: "SET_LOADING", payload: false });
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load workflow";
      dispatch({ type: "SET_ERROR", payload: message });
      dispatch({ type: "SET_LOADING", payload: false });
      return false;
    }
  }, []);

  const exportWorkflow = useCallback(
    async (id: string): Promise<WorkflowExport | null> => {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const data = await workflowApi.exportWorkflow(id);
        dispatch({ type: "SET_LOADING", payload: false });
        return data as WorkflowExport;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to export workflow";
        dispatch({ type: "SET_ERROR", payload: message });
        dispatch({ type: "SET_LOADING", payload: false });
        return null;
      }
    },
    [],
  );

  const importWorkflow = useCallback(
    async (
      workflow: UnifiedWorkflow,
      conflictStrategy: "keep" | "generate" | "overwrite" = "generate",
    ): Promise<WorkflowImportResult | null> => {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const data = await workflowApi.importWorkflow(workflow);
        dispatch({ type: "SET_LOADING", payload: false });
        return {
          workflow: data,
          overwritten: conflictStrategy === "overwrite",
          original_id: conflictStrategy === "keep" ? workflow.id : null,
        } as WorkflowImportResult;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to import workflow";
        dispatch({ type: "SET_ERROR", payload: message });
        dispatch({ type: "SET_LOADING", payload: false });
        return null;
      }
    },
    [],
  );

  const value: WorkflowBuilderContextValue = {
    state,
    features,
    hasUnsavedChanges,
    isEmpty,
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
  };

  return (
    <WorkflowBuilderContext.Provider value={value}>
      {children}
    </WorkflowBuilderContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useWorkflowBuilder(): WorkflowBuilderContextValue {
  const context = useContext(WorkflowBuilderContext);
  if (!context) {
    throw new Error(
      "useWorkflowBuilder must be used within a WorkflowBuilderProvider",
    );
  }
  return context;
}
