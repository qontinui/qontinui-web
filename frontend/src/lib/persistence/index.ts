/**
 * Persistence Layer Public API
 *
 * This module provides a unified interface for data persistence in the application.
 * The Zustand store is the single source of truth - all other layers delegate to it.
 *
 * ARCHITECTURE:
 *
 *   Backend API (PostgreSQL/S3)
 *       ↑↓
 *   SyncCoordinator (future: unified sync orchestrator)
 *       ↑↓
 *   Repository Layer (IndexedDB - entity-specific access)
 *       ↑↓
 *   Zustand Store (SINGLE source of truth)
 *       ↓ (read-only forwarding)
 *   React Context (compatibility shim) → UI Components
 */

// Bridge for backward compatibility with useAutomation() context
export { useAutomationBridge } from "./zustand-bridge";

// Type exports
export type {
  // Domain types
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
  ProjectSettings,
  Workflow,
  // Persistence-specific types
  HydrationStatus,
  SyncStatus,
  ProjectConfiguration,
} from "./types";
