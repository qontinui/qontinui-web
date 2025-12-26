/**
 * Unified Persistence Types
 *
 * These types define the contract between the UI layer and the persistence layer.
 * The Zustand store is the single source of truth - React Context is just a compatibility shim.
 */

// Re-export all domain types from the canonical location
export type {
  State,
  StateRegion,
  StateLocation,
  StateString,
  StateImage,
  SearchRegion,
  Position,
  PositionName,
  Pattern,
  Transition,
  TransitionType,
  BaseTransition,
  OutgoingTransition,
  IncomingTransition,
  ImageAsset,
  ImageUsage,
  ActionHistory,
  Screenshot,
  ScreenshotRegionAnnotation,
  ScreenshotLocationAnnotation,
  Schedule,
  ExecutionRecord,
  TriggerType,
  CheckMode,
  ScheduleType,
  StateCheckResult,
  SchedulerStatistics,
  RAGEmbeddingResult,
  RAGSetupResults,
} from "@/contexts/automation-context/types";

export type { ProjectSettings } from "@/types/project-settings";
export type { Workflow } from "@/lib/action-schema/action-types";

/**
 * Hydration status for persistence layers
 */
export interface HydrationStatus {
  isHydrated: boolean;
  isHydrating: boolean;
  error: Error | null;
}

/**
 * Sync status for backend operations
 */
export interface SyncStatus {
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingChanges: number;
  error: Error | null;
}

/**
 * Project configuration for export/import
 */
export interface ProjectConfiguration {
  name: string;
  version: string;
  workflows: unknown[];
  states: unknown[];
  transitions: unknown[];
  images: unknown[];
  screenshots: unknown[];
  schedules: unknown[];
  settings: unknown;
  categories: string[];
}
