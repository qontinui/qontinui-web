import type {
  UnifiedStep,
  UnifiedWorkflow,
  WorkflowExport,
  WorkflowFeatures,
  WorkflowImportResult,
  WorkflowPhase,
  WorkflowStage,
} from "@/types/unified-workflow";

export interface WorkflowBuilderState {
  workflow: UnifiedWorkflow;
  originalWorkflow: UnifiedWorkflow | null;
  selectedStepId: string | null;
  currentStageIndex: number | null; // null = top-level (single-stage mode)
  expandedPhases: Record<WorkflowPhase, boolean>;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

export interface WorkflowBuilderContextValue {
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
