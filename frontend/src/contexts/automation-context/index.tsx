/**
 * Automation Context - Main Entry Point
 *
 * This module provides the automation context for managing states, transitions,
 * workflows, and images in the Qontinui application.
 *
 * Architecture:
 * - State is managed by Zustand store (stores/automation)
 * - Context provides React integration via useAutomation hook
 * - AutomationProvider wraps the app and provides the context
 *
 * The implementation uses a bridge pattern:
 * - AutomationProvider uses useAutomationBridge() from lib/persistence/zustand-bridge.ts
 * - The bridge delegates all state and methods to the Zustand store
 * - This eliminates duplicate state between Context and Zustand
 */

// Re-export types for external use
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
  Schedule,
  ExecutionRecord,
  TriggerType,
  CheckMode,
  ScheduleType,
  StateCheckResult,
  SchedulerStatistics,
  AutomationContextType,
  Category,
} from "./types";

// Re-export utility classes
export { StateIdManager } from "./state-id-manager";
export { TransitionReferenceUpdater } from "./transition-reference-updater";
export { StateUpdateCoordinator } from "./state-update-coordinator";

// Re-export context and hook from shared context
export { AutomationContext, useAutomation } from "./context";

// Re-export provider from V2 implementation
export { AutomationProvider } from "./AutomationProviderV2";

import type { Category } from "./types";

// Default workflow categories that always appear, even when empty
export const DEFAULT_CATEGORIES: Category[] = [
  { name: "Main", automationEnabled: true },
  { name: "Incoming Transitions", automationEnabled: false },
  { name: "Outgoing Transitions", automationEnabled: false },
];

// Default category names for convenience (used for checking protected categories)
export const DEFAULT_CATEGORY_NAMES = DEFAULT_CATEGORIES.map((c) => c.name);
