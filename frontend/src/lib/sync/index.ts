/**
 * Sync Module
 *
 * Unified synchronization system for local and backend data.
 *
 * USAGE:
 * ```typescript
 * import { syncCoordinator, debounceManager, conflictResolver } from "@/lib/sync";
 *
 * // Initialize coordinator
 * syncCoordinator.initialize({ projectId: "xxx", enabled: true });
 *
 * // Register save function
 * syncCoordinator.registerSaveFunction(async () => {
 *   await api.saveProject(data);
 * });
 *
 * // Schedule debounced save
 * syncCoordinator.scheduleSave();
 *
 * // Subscribe to sync status
 * const unsubscribe = syncCoordinator.subscribe((status) => {
 *   console.log("Sync status:", status);
 * });
 * ```
 */

// Core exports
export { syncCoordinator } from "./sync-coordinator";
export type {
  SyncStatus,
  SyncCoordinatorConfig,
  SyncStatusListener,
  SaveFunction,
  ConfigurationGetter,
} from "./sync-coordinator";

export { debounceManager, DEBOUNCE_TIMERS } from "./debounce-manager";
export type { DebounceConfig } from "./debounce-manager";

export { conflictResolver } from "./conflict-resolver";
export type {
  ConflictStrategy,
  ConflictInfo,
  ResolutionResult,
  ConflictResolverConfig,
} from "./conflict-resolver";
