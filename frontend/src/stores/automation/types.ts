/**
 * Automation Store Types
 *
 * Type definitions for the Zustand automation store.
 * Imports domain types from the existing types file.
 */

import type {
  State,
  Transition,
  ImageAsset,
  ImageUsage,
  Screenshot,
  Schedule,
  ExecutionRecord,
  ActionHistory,
  Pattern,
  RAGSetupResults,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  OutgoingTransition,
  IncomingTransition,
  SearchRegion,
  Position,
  PositionName,
  TriggerType,
  CheckMode,
  ScheduleType,
  TransitionType,
  BaseTransition,
  OCRFilter,
  OCRConfig,
  ScreenshotRegionAnnotation,
  ScreenshotLocationAnnotation,
  SchedulerStatistics,
  StateCheckResult,
  RAGEmbeddingResult,
  Category,
} from "@/contexts/automation-context/types";
import type { ProjectSettings } from "@/types/project-settings";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { Context } from "@qontinui/shared-types/config";

// Re-export domain types for convenience
export type {
  State,
  Transition,
  ImageAsset,
  ImageUsage,
  Screenshot,
  Schedule,
  ExecutionRecord,
  ActionHistory,
  Pattern,
  RAGSetupResults,
  ProjectSettings,
  Workflow,
  Context,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  OutgoingTransition,
  IncomingTransition,
  SearchRegion,
  Position,
  PositionName,
  TriggerType,
  CheckMode,
  ScheduleType,
  TransitionType,
  BaseTransition,
  OCRFilter,
  OCRConfig,
  ScreenshotRegionAnnotation,
  ScreenshotLocationAnnotation,
  SchedulerStatistics,
  StateCheckResult,
  RAGEmbeddingResult,
  Category,
};

// Re-export enums (need value export, not just type)
export { MatchingStrategy, OCRMatchMode } from "@/types/rag-builder";

// ============================================================================
// Slice Interfaces
// ============================================================================

export interface ProjectSlice {
  // State
  projectName: string;
  projectId: string | null;
  lastSaved: string | null;
  isLoadingFromBackend: boolean;
  categories: Category[];

  // Actions
  setProjectName: (name: string) => void;
  setProjectId: (id: string | null) => void;
  setLastSaved: (timestamp: string | null) => void;
  setIsLoadingFromBackend: (loading: boolean) => void;
  triggerSave: () => void;
  renameProject: (newName: string) => Promise<void>;
  addCategory: (category: string) => void;
  deleteCategory: (category: string) => void;
  updateCategory: (category: Category) => void;
  setCategories: (categories: Category[]) => void;
}

export interface WorkflowSlice {
  // State
  workflows: Workflow[];

  // Actions
  setWorkflows: (workflows: Workflow[]) => void;
  addWorkflow: (workflow: Workflow) => void;
  updateWorkflow: (workflow: Workflow) => void;
  deleteWorkflow: (workflowId: string) => void;
  deleteWorkflows: (workflowIds: string[]) => void;
}

export interface StateSlice {
  // State
  states: State[];

  // Actions
  setStates: (states: State[]) => void;
  addState: (state: State) => void;
  updateState: (state: State) => void;
  updateStateWithIdChange: (oldId: string, newState: State) => void;
  deleteState: (stateId: string) => void;
  batchUpdateStateMonitors: (stateIds: string[], monitors: number[]) => void;

  // Action history updates
  updateStateImageActionHistory: (
    stateId: string,
    imageId: string,
    actionHistory: ActionHistory
  ) => void;
  updateStateLocationActionHistory: (
    stateId: string,
    locationId: string,
    actionHistory: ActionHistory
  ) => void;
  updateStateRegionActionHistory: (
    stateId: string,
    regionId: string,
    actionHistory: ActionHistory
  ) => void;

  // RAG setup
  applyRAGSetupResults: (results: RAGSetupResults) => void;
}

export interface TransitionSlice {
  // State
  transitions: Transition[];

  // Actions
  setTransitions: (transitions: Transition[]) => void;
  addTransition: (transition: Transition) => boolean;
  updateTransition: (transition: Transition) => void;
  deleteTransition: (transitionId: string) => void;

  // Cross-entity helpers (called by middleware)
  removeStateFromTransitions: (stateId: string) => void;
  updateStateReferencesInTransitions: (
    oldStateId: string,
    newStateId: string
  ) => void;
  removeWorkflowFromTransitions: (workflowId: string) => void;
}

export interface ImageSlice {
  // State
  images: ImageAsset[];

  // Actions
  setImages: (images: ImageAsset[]) => void;
  addImage: (image: ImageAsset) => void;
  updateImage: (image: ImageAsset) => void;
  deleteImage: (imageId: string) => void;
  updateImageUsage: (imageId: string, usage: ImageUsage) => void;
  removeImageUsage: (imageId: string, usageId: string) => void;

  // Helpers
  getImageById: (imageId: string | undefined) => ImageAsset | null;
  getImageUsage: (imageId: string) => {
    states: Array<{ id: string; name: string }>;
    processes: Array<{ id: string; name: string; actionCount: number }>;
  };
  resolvePatternImage: (
    pattern: Pattern
  ) => { url: string; mask?: string } | null;
}

export interface ScreenshotSlice {
  // State
  screenshots: Screenshot[];

  // Actions
  setScreenshots: (screenshots: Screenshot[]) => void;
  addScreenshot: (screenshot: Screenshot) => void;
  updateScreenshot: (screenshot: Screenshot) => void;
  deleteScreenshot: (screenshotId: string) => void;
  syncScreenshotsFromBackend: (projectId: string) => Promise<void>;
}

export interface ScheduleSlice {
  // State
  schedules: Schedule[];
  executionRecords: ExecutionRecord[];

  // Actions
  setSchedules: (schedules: Schedule[]) => void;
  addSchedule: (schedule: Schedule) => void;
  updateSchedule: (schedule: Schedule) => void;
  deleteSchedule: (scheduleId: string) => void;

  // Execution records
  setExecutionRecords: (records: ExecutionRecord[]) => void;
  getScheduleExecutions: (scheduleId: string) => ExecutionRecord[];
  getSchedulerStatistics: () => {
    totalSchedules: number;
    activeSchedules: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageIterationCount: number;
  };
}

export interface SettingsSlice {
  // State
  settings: ProjectSettings;

  // Actions
  setSettings: (settings: ProjectSettings) => void;
  updateSettings: (settings: Partial<ProjectSettings>) => void;
}

export interface ContextsSlice {
  // State
  contexts: Context[];

  // Actions
  setContexts: (contexts: Context[]) => void;
  addContext: (context: Context) => void;
  updateContext: (context: Context) => void;
  deleteContext: (contextId: string) => void;
}

// ============================================================================
// Combined Store Type
// ============================================================================

export type AutomationStore = ProjectSlice &
  WorkflowSlice &
  StateSlice &
  TransitionSlice &
  ImageSlice &
  ScreenshotSlice &
  ScheduleSlice &
  SettingsSlice &
  ContextsSlice & {
    // Configuration operations
    getConfiguration: () => Record<string, unknown>;
    loadConfiguration: (config: Record<string, unknown>) => Promise<void>;
    clearAllData: () => void;

    // Cross-entity operations (for cascade updates)
    removeImageFromStates: (imageUrl: string) => Promise<number>;
    markImageAsRemovedInProcesses: (
      imageId: string,
      imageName: string
    ) => Promise<number>;
  };
