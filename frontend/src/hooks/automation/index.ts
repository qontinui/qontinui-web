/**
 * Automation Hooks Barrel Export
 *
 * Domain-specific hooks for automation data management.
 */

export { useProject } from "./useProject";
export { useWorkflows } from "./useWorkflows";
export { useStates } from "./useStates";
export { useTransitions } from "./useTransitions";
export { useImages } from "./useImages";
export { useScreenshots } from "./useScreenshots";
export { useSchedules } from "./useSchedules";
export { useSettings } from "./useSettings";
export { useConfiguration } from "./useConfiguration";

// Re-export store for direct access when needed
export { useAutomationStore, hydrateStore, resetStore } from "@/stores/automation";

// Re-export types
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
  Workflow,
  ProjectSettings,
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
  RAGSetupResults,
} from "@/stores/automation";

// Re-export enums
export { MatchingStrategy, OCRMatchMode } from "@/stores/automation";
