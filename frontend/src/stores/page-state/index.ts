/**
 * Page State Module
 *
 * Exports for IndexedDB-backed page state persistence.
 * Use these stores and hooks to persist page state across navigation.
 */

// Database
export { pageStateDB, makePageKey } from "./page-state-db";
export type { PageMetadata, PageBlob } from "./page-state-db";

// Types
export * from "./types";

// Stores
export {
  usePatternTestsStore,
  selectIsHydrated as selectPatternTestsIsHydrated,
  selectIsHydrating as selectPatternTestsIsHydrating,
  selectSelectedScreenshot as selectPatternTestsScreenshot,
  selectTemplateImage as selectPatternTestsTemplate,
  selectMatches as selectPatternTestsMatches,
  selectSimilarity as selectPatternTestsSimilarity,
} from "./pattern-tests-store";

export {
  useSemanticAnalysisStore,
  selectIsHydrated as selectSemanticAnalysisIsHydrated,
  selectIsHydrating as selectSemanticAnalysisIsHydrating,
  selectSelectedScreenshotId as selectSemanticAnalysisScreenshotId,
  selectSelectedElementIds as selectSemanticAnalysisElementIds,
  selectAnalysisResults as selectSemanticAnalysisResults,
  selectShowOverlay as selectSemanticAnalysisShowOverlay,
  selectHighlightMode as selectSemanticAnalysisHighlightMode,
} from "./semantic-analysis-store";

export {
  useDependenciesStore,
  selectIsHydrated as selectDependenciesIsHydrated,
  selectIsHydrating as selectDependenciesIsHydrating,
  selectActiveTab as selectDependenciesActiveTab,
  selectSearchQuery as selectDependenciesSearchQuery,
  selectFiltersOpen as selectDependenciesFiltersOpen,
  selectFilters as selectDependenciesFilters,
  selectGraphViewport as selectDependenciesGraphViewport,
  selectSelectedWorkflowId as selectDependenciesSelectedWorkflowId,
} from "./dependencies-store";

export {
  useVariablesStore,
  selectIsHydrated as selectVariablesIsHydrated,
  selectIsHydrating as selectVariablesIsHydrating,
  selectSearchQuery as selectVariablesSearchQuery,
  selectSelectedVariableIds as selectVariablesSelectedIds,
  selectSortField as selectVariablesSortField,
  selectSortDirection as selectVariablesSortDirection,
  selectFilterType as selectVariablesFilterType,
} from "./variables-store";

export {
  usePatternOptimizationStore,
  selectIsHydrated as selectPatternOptimizationIsHydrated,
  selectIsHydrating as selectPatternOptimizationIsHydrating,
  selectSelectedScreenshotId as selectPatternOptimizationScreenshotId,
  selectConfig as selectPatternOptimizationConfig,
  selectEditMode as selectPatternOptimizationEditMode,
  selectEditedPatternUrl as selectPatternOptimizationEditedPatternUrl,
} from "./pattern-optimization-store";

export {
  useScreenshotsStore,
  selectIsHydrated as selectScreenshotsIsHydrated,
  selectIsHydrating as selectScreenshotsIsHydrating,
  selectUploadedScreenshots as selectScreenshotsUploadedScreenshots,
  selectSelectedScreenshotIds as selectScreenshotsSelectedIds,
  selectViewMode as selectScreenshotsViewMode,
  selectSortBy as selectScreenshotsSortBy,
  selectSortDirection as selectScreenshotsSortDirection,
} from "./screenshots-store";

export {
  useStatesStore,
  selectIsHydrated as selectStatesIsHydrated,
  selectIsHydrating as selectStatesIsHydrating,
  selectViewport as selectStatesViewport,
  selectSelectedStateIds as selectStatesSelectedStateIds,
  selectSelectedTransitionIds as selectStatesSelectedTransitionIds,
  selectEditingStateId as selectStatesEditingStateId,
  selectShowGrid as selectStatesShowGrid,
  selectSnapToGrid as selectStatesSnapToGrid,
} from "./states-store";

// Hooks
export { createPageStateHook } from "./hooks/use-page-state-hydration";

// Bridge hooks for page state persistence
export { usePatternTestsBridge } from "./hooks/use-pattern-tests-bridge";
export type {
  TemplateSource,
  MatchResult,
} from "./hooks/use-pattern-tests-bridge";

export { useSemanticAnalysisBridge } from "./hooks/use-semantic-analysis-bridge";

export { useDependenciesBridge } from "./hooks/use-dependencies-bridge";

export { useVariablesBridge } from "./hooks/use-variables-bridge";

export { usePatternOptimizationBridge } from "./hooks/use-pattern-optimization-bridge";

export { useScreenshotsBridge } from "./hooks/use-screenshots-bridge";
export type { Screenshot as BridgeScreenshot } from "./hooks/use-screenshots-bridge";

export { useStatesBridge } from "./hooks/use-states-bridge";
