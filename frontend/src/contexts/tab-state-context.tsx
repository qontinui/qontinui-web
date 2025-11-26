/**
 * Tab State Context - Backwards Compatibility
 *
 * This file re-exports from the refactored tab-state module.
 * New code should import from '@/contexts/tab-state' directly.
 *
 * @deprecated Import from '@/contexts/tab-state' instead
 */

export {
  TabStateProvider,
  useTabState,
  useTabStateSafe,
  useTabStateContext,
  useImageExtractionState,
  usePatternMatchingState,
  useScreenshotAnnotationState,
  usePatternOptimizationState,
} from './tab-state'

export type {
  ImageExtractionState,
  PatternMatchingState,
  ScreenshotAnnotationState,
  PatternOptimizationState,
  TabStates,
} from './tab-state'
