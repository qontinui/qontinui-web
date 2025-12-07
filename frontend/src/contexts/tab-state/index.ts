/**
 * Tab State Module
 *
 * Re-exports all tab state functionality from a single entry point.
 *
 * Usage:
 *   import { TabStateProvider, useTabState, useTabStateSafe } from '@/contexts/tab-state'
 *   import { useImageExtractionState } from '@/contexts/tab-state'
 */

// Types
export type {
  RegionSelection,
  ImageExtractionState,
  PatternMatchingState,
  ScreenshotAnnotationState,
  PatternOptimizationState,
  TabStates,
} from "./types";

export {
  DEFAULT_IMAGE_EXTRACTION_STATE,
  DEFAULT_PATTERN_MATCHING_STATE,
  DEFAULT_SCREENSHOT_ANNOTATION_STATE,
  DEFAULT_PATTERN_OPTIMIZATION_STATE,
} from "./types";

// Storage utilities
export { loadTabStates, saveTabStates, clearTabStates } from "./storage";

// Context and hooks
export {
  TabStateProvider,
  useTabState,
  useTabStateSafe,
  useTabStateContext,
  useImageExtractionState,
  usePatternMatchingState,
  useScreenshotAnnotationState,
  usePatternOptimizationState,
} from "./context";
