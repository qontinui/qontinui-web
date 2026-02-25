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
  WorkflowStage,
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
  currentStageIndex: number | null; // null = top-level (single-stage mode)
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
  | { type: "MARK_SAVED" }
  | { type: "ADD_STAGE"; payload: { name: string } }
  | { type: "REMOVE_STAGE"; payload: { stageIndex: number } }
  | { type: "SELECT_STAGE"; payload: number | null }
  | {
      type: "UPDATE_STAGE";
      payload: { stageIndex: number; updates: Partial<WorkflowStage> };
    }
  | {
      type: "MOVE_STAGE";
      payload: { stageIndex: number; direction: "up" | "down" };
    }
  | { type: "ENABLE_STAGES" }
  | { type: "DISABLE_STAGES" };

// =============================================================================
// Stage-Aware Helpers
// =============================================================================

/** Get the step array for a given phase, respecting stage context. */
function getPhaseSteps(
  workflow: UnifiedWorkflow,
  stageIndex: number | null,
  phase: WorkflowPhase
): UnifiedStep[] {
  const source =
    stageIndex !== null && workflow.stages?.[stageIndex]
      ? workflow.stages[stageIndex]
      : workflow;
  switch (phase) {
    case "setup":
      return source.setup_steps ?? [];
    case "verification":
      return source.verification_steps ?? [];
    case "agentic":
      return source.agentic_steps ?? [];
    case "completion":
      return source.completion_steps ?? [];
    default:
      return [];
  }
}

/** Return a new workflow with the given steps set for the phase, respecting stage context. */
function setPhaseSteps(
  workflow: UnifiedWorkflow,
  stageIndex: number | null,
  phase: WorkflowPhase,
  steps: UnifiedStep[]
): UnifiedWorkflow {
  if (stageIndex !== null && workflow.stages) {
    const stages = workflow.stages.map((s, i) => {
      if (i !== stageIndex) return s;
      const updated = { ...s };
      switch (phase) {
        case "setup":
          updated.setup_steps = steps as SetupStep[];
          break;
        case "verification":
          updated.verification_steps = steps as VerificationStep[];
          break;
        case "agentic":
          updated.agentic_steps = steps as AgenticStep[];
          break;
        case "completion":
          updated.completion_steps = steps as CompletionStep[];
          break;
      }
      return updated;
    });
    return { ...workflow, stages };
  }
  switch (phase) {
    case "setup":
      return { ...workflow, setup_steps: steps as SetupStep[] };
    case "verification":
      return { ...workflow, verification_steps: steps as VerificationStep[] };
    case "agentic":
      return { ...workflow, agentic_steps: steps as AgenticStep[] };
    case "completion":
      return { ...workflow, completion_steps: steps as CompletionStep[] };
    default:
      return workflow;
  }
}

// =============================================================================
// Reducer
// =============================================================================

function workflowBuilderReducer(
  state: WorkflowBuilderState,
  action: WorkflowBuilderAction
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

      // Check for duplicate IDs across all phases of the active context
      const allSteps = (
        ["setup", "verification", "agentic", "completion"] as WorkflowPhase[]
      ).flatMap((p) =>
        getPhaseSteps(state.workflow, state.currentStageIndex, p)
      );
      if (allSteps.some((s) => s.id === stepWithId.id)) return state;

      const existing = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );
      let newSteps: UnifiedStep[];

      if (phase === "completion") {
        const summaryIndex = existing.findIndex(
          (s) =>
            s.type === "prompt" && (s as PromptStep).is_summary_step === true
        );
        if (summaryIndex >= 0) {
          newSteps = [
            ...existing.slice(0, summaryIndex),
            stepWithId,
            ...existing.slice(summaryIndex),
          ];
        } else {
          newSteps = [...existing, stepWithId];
        }
      } else {
        newSteps = [...existing, stepWithId];
      }

      return {
        ...state,
        workflow: setPhaseSteps(
          state.workflow,
          state.currentStageIndex,
          phase,
          newSteps
        ),
        selectedStepId: stepWithId.id,
        expandedPhases: { ...state.expandedPhases, [phase]: true },
      };
    }

    case "REMOVE_STEP": {
      const { stepId, phase } = action.payload;
      const steps = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );
      const filtered = steps.filter((s) => s.id !== stepId);
      return {
        ...state,
        workflow: setPhaseSteps(
          state.workflow,
          state.currentStageIndex,
          phase,
          filtered
        ),
        selectedStepId:
          state.selectedStepId === stepId ? null : state.selectedStepId,
      };
    }

    case "UPDATE_STEP": {
      const { step, phase } = action.payload;
      const steps = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );
      const updated = steps.map((s) => (s.id === step.id ? step : s));
      return {
        ...state,
        workflow: setPhaseSteps(
          state.workflow,
          state.currentStageIndex,
          phase,
          updated
        ),
      };
    }

    case "MOVE_STEP": {
      const { stepId, phase, direction } = action.payload;
      const steps = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );

      // Preserve completion summary step locking
      if (phase === "completion") {
        const stepToMove = steps.find((s) => s.id === stepId);
        if (
          stepToMove?.type === "prompt" &&
          (stepToMove as PromptStep).is_summary_step
        )
          return state;
        if (direction === "down") {
          const idx = steps.findIndex((s) => s.id === stepId);
          const nextStep = steps[idx + 1];
          if (
            nextStep?.type === "prompt" &&
            (nextStep as PromptStep).is_summary_step
          )
            return state;
        }
      }

      const index = steps.findIndex((s) => s.id === stepId);
      if (index === -1) return state;
      if (direction === "up" && index === 0) return state;
      if (direction === "down" && index === steps.length - 1) return state;

      const newSteps = [...steps];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      [newSteps[index], newSteps[targetIndex]] = [
        newSteps[targetIndex]!,
        newSteps[index]!,
      ];

      return {
        ...state,
        workflow: setPhaseSteps(
          state.workflow,
          state.currentStageIndex,
          phase,
          newSteps
        ),
      };
    }

    case "REORDER_STEPS": {
      const { phase, stepIds } = action.payload;
      const steps = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );
      const map = new Map(steps.map((s) => [s.id, s]));
      const reordered: UnifiedStep[] = [];
      for (const id of stepIds) {
        const item = map.get(id);
        if (item) reordered.push(item);
      }
      // Append any items not in stepIds (e.g. summary step)
      for (const item of steps) {
        if (!stepIds.includes(item.id)) reordered.push(item);
      }
      return {
        ...state,
        workflow: setPhaseSteps(
          state.workflow,
          state.currentStageIndex,
          phase,
          reordered
        ),
      };
    }

    case "DUPLICATE_STEP": {
      const { stepId, phase } = action.payload;
      const steps = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );
      const index = steps.findIndex((s) => s.id === stepId);
      if (index === -1) return state;
      const original = steps[index]!;
      const newId = generateStepId();
      const clone = {
        ...JSON.parse(JSON.stringify(original)),
        id: newId,
        name: `${(original as UnifiedStep & { name: string }).name} (copy)`,
      };
      const newSteps = [...steps];
      newSteps.splice(index + 1, 0, clone);
      return {
        ...state,
        workflow: setPhaseSteps(
          state.workflow,
          state.currentStageIndex,
          phase,
          newSteps
        ),
        selectedStepId: newId,
      };
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

    case "ADD_STAGE": {
      const existingStages = state.workflow.stages ?? [];
      const newStage: WorkflowStage = {
        id: generateStepId(),
        name: action.payload.name,
        description: "",
        setup_steps: [],
        verification_steps: [],
        agentic_steps: [],
        completion_steps: [],
        max_iterations: state.workflow.max_iterations ?? 10,
      };
      return {
        ...state,
        workflow: {
          ...state.workflow,
          stages: [...existingStages, newStage],
        },
        currentStageIndex: existingStages.length,
      };
    }

    case "REMOVE_STAGE": {
      const { stageIndex } = action.payload;
      const stages = state.workflow.stages ?? [];
      if (stageIndex < 0 || stageIndex >= stages.length) return state;
      const newStages = stages.filter((_, i) => i !== stageIndex);
      let newCurrentStage = state.currentStageIndex;
      if (newStages.length === 0) {
        newCurrentStage = null;
      } else if (
        newCurrentStage !== null &&
        newCurrentStage >= newStages.length
      ) {
        newCurrentStage = newStages.length - 1;
      }
      return {
        ...state,
        workflow: {
          ...state.workflow,
          stages: newStages.length > 0 ? newStages : undefined,
        },
        currentStageIndex: newCurrentStage,
        selectedStepId: null,
      };
    }

    case "SELECT_STAGE":
      return {
        ...state,
        currentStageIndex: action.payload,
        selectedStepId: null,
      };

    case "UPDATE_STAGE": {
      const { stageIndex, updates } = action.payload;
      const stages = state.workflow.stages ?? [];
      if (stageIndex < 0 || stageIndex >= stages.length) return state;
      const updatedStages = stages.map((s, i) =>
        i === stageIndex ? { ...s, ...updates } : s
      );
      return {
        ...state,
        workflow: { ...state.workflow, stages: updatedStages },
      };
    }

    case "MOVE_STAGE": {
      const { stageIndex, direction } = action.payload;
      const stages = state.workflow.stages ?? [];
      if (stageIndex < 0 || stageIndex >= stages.length) return state;
      if (direction === "up" && stageIndex === 0) return state;
      if (direction === "down" && stageIndex === stages.length - 1)
        return state;
      const targetIndex = direction === "up" ? stageIndex - 1 : stageIndex + 1;
      const newStages = [...stages];
      [newStages[stageIndex], newStages[targetIndex]] = [
        newStages[targetIndex]!,
        newStages[stageIndex]!,
      ];
      return {
        ...state,
        workflow: { ...state.workflow, stages: newStages },
        currentStageIndex: targetIndex,
      };
    }

    case "ENABLE_STAGES": {
      if (state.workflow.stages && state.workflow.stages.length > 0)
        return state;
      // Move top-level steps into Stage 1
      const stage1: WorkflowStage = {
        id: generateStepId(),
        name: "Stage 1",
        setup_steps: state.workflow.setup_steps,
        verification_steps: state.workflow.verification_steps,
        agentic_steps: state.workflow.agentic_steps,
        completion_steps: state.workflow.completion_steps ?? [],
        max_iterations: state.workflow.max_iterations ?? 10,
      };
      return {
        ...state,
        workflow: {
          ...state.workflow,
          stages: [stage1],
          setup_steps: [],
          verification_steps: [],
          agentic_steps: [],
          completion_steps: [],
        },
        currentStageIndex: 0,
      };
    }

    case "DISABLE_STAGES": {
      const stages = state.workflow.stages ?? [];
      if (stages.length === 0) return state;
      // Move first stage's steps back to top level
      const first = stages[0]!;
      return {
        ...state,
        workflow: {
          ...state.workflow,
          stages: undefined,
          setup_steps: first.setup_steps ?? [],
          verification_steps: first.verification_steps ?? [],
          agentic_steps: first.agentic_steps ?? [],
          completion_steps: first.completion_steps ?? [],
        },
        currentStageIndex: null,
        selectedStepId: null,
      };
    }

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
    currentStageIndex: null,
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
    [state.workflow]
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
    [state.workflow]
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
    []
  );

  const reorderSteps = useCallback(
    (phase: WorkflowPhase, stepIds: string[]) => {
      dispatch({ type: "REORDER_STEPS", payload: { phase, stepIds } });
    },
    []
  );

  const duplicateStep = useCallback((stepId: string, phase: WorkflowPhase) => {
    dispatch({ type: "DUPLICATE_STEP", payload: { stepId, phase } });
  }, []);

  const selectStep = useCallback((stepId: string | null) => {
    dispatch({ type: "SELECT_STEP", payload: stepId });
  }, []);

  const getSelectedStep = useCallback((): UnifiedStep | null => {
    if (!state.selectedStepId) return null;
    const phases: WorkflowPhase[] = [
      "setup",
      "verification",
      "agentic",
      "completion",
    ];
    for (const phase of phases) {
      const steps = getPhaseSteps(
        state.workflow,
        state.currentStageIndex,
        phase
      );
      const found = steps.find((s) => s.id === state.selectedStepId);
      if (found) return found;
    }
    return null;
  }, [state.selectedStepId, state.workflow, state.currentStageIndex]);

  const togglePhase = useCallback((phase: WorkflowPhase) => {
    dispatch({ type: "TOGGLE_PHASE", payload: phase });
  }, []);

  const setPhaseExpanded = useCallback(
    (phase: WorkflowPhase, expanded: boolean) => {
      dispatch({ type: "SET_PHASE_EXPANDED", payload: { phase, expanded } });
    },
    []
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

  const currentStage = useMemo((): WorkflowStage | null => {
    if (state.currentStageIndex === null) return null;
    return state.workflow.stages?.[state.currentStageIndex] ?? null;
  }, [state.currentStageIndex, state.workflow.stages]);

  const addStage = useCallback((name: string) => {
    dispatch({ type: "ADD_STAGE", payload: { name } });
  }, []);

  const removeStage = useCallback((stageIndex: number) => {
    dispatch({ type: "REMOVE_STAGE", payload: { stageIndex } });
  }, []);

  const selectStage = useCallback((stageIndex: number | null) => {
    dispatch({ type: "SELECT_STAGE", payload: stageIndex });
  }, []);

  const updateStage = useCallback(
    (stageIndex: number, updates: Partial<WorkflowStage>) => {
      dispatch({ type: "UPDATE_STAGE", payload: { stageIndex, updates } });
    },
    []
  );

  const moveStage = useCallback(
    (stageIndex: number, direction: "up" | "down") => {
      dispatch({ type: "MOVE_STAGE", payload: { stageIndex, direction } });
    },
    []
  );

  const enableStages = useCallback(() => {
    dispatch({ type: "ENABLE_STAGES" });
  }, []);

  const disableStages = useCallback(() => {
    dispatch({ type: "DISABLE_STAGES" });
  }, []);

  const getActiveSteps = useCallback(
    (phase: WorkflowPhase): UnifiedStep[] => {
      return getPhaseSteps(state.workflow, state.currentStageIndex, phase);
    },
    [state.workflow, state.currentStageIndex]
  );

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
    []
  );

  const importWorkflow = useCallback(
    async (
      workflow: UnifiedWorkflow,
      conflictStrategy: "keep" | "generate" | "overwrite" = "generate"
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
    []
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
    currentStageIndex: state.currentStageIndex,
    currentStage,
    addStage,
    removeStage,
    selectStage,
    updateStage,
    moveStage,
    enableStages,
    disableStages,
    getActiveSteps,
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
      "useWorkflowBuilder must be used within a WorkflowBuilderProvider"
    );
  }
  return context;
}
