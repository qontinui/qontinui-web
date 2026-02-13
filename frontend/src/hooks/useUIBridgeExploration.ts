/**
 * UI Bridge Exploration Hook - Re-export shim
 *
 * The implementation has been split into focused sub-modules under ./ui-bridge/.
 * This file re-exports everything for backward compatibility with existing imports.
 *
 * Canonical location: ./ui-bridge/
 */

// Main hook
export { useUIBridgeExploration } from "./ui-bridge";

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
} from "./ui-bridge";

// Constants
export { DEFAULT_EXPLORATION_CONFIG } from "./ui-bridge";
