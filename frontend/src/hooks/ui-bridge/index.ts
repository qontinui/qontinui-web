/**
 * UI Bridge Hooks
 *
 * Barrel export for all UI Bridge exploration hooks and types.
 */

// Main orchestrator hook
export { useUIBridgeExploration } from "./useUIBridgeExploration";

// Sub-hooks
export { useExplorationDiscovery } from "./useExplorationDiscovery";
export { useRenderLogProcessing } from "./useRenderLogProcessing";
export { useSafetyGuard } from "./useSafetyGuard";
export { useExplorationStrategy } from "./useExplorationStrategy";

// All types
export type {
  TargetType,
  BrowserTab,
  UIBridgeExplorationConfig,
  ExploredElement,
  ExplorationRenderLog,
  ExplorationProgress,
  ExplorationResults,
  PlaywrightJobStatus,
  PlaywrightRawResults,
  UIBridgeJobStatus,
  UIBridgeDiscoveredState,
  UIBridgeDiscoveredElement,
  UIBridgeStateDiscovery,
  UIBridgeRenderLog,
  UIBridgeActionResult,
  UIBridgeExplorationStep,
  SuggestedTransition,
  TransitionBuildResult,
  UIBridgeRawResults,
  ExplorationSession,
  ExplorationSessionResponse,
} from "./types";

// Constants
export { DEFAULT_EXPLORATION_CONFIG } from "./types";

// Sub-hook return types
export type { UseExplorationDiscoveryReturn } from "./useExplorationDiscovery";
export type { UseRenderLogProcessingReturn } from "./useRenderLogProcessing";
export type { UseSafetyGuardReturn } from "./useSafetyGuard";
export type {
  UseExplorationStrategyReturn,
  UseExplorationStrategyDeps,
} from "./useExplorationStrategy";
