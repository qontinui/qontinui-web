/**
 * Sync Module
 *
 * Unified synchronization system for local and backend data.
 *
 * ARCHITECTURE:
 * - SyncCoordinator: Main orchestrator integrating all components
 * - SyncStateMachine: Manages sync state transitions (idle, editing, saving, locked, etc.)
 * - VersionTracker: Optimistic concurrency control with version vectors
 * - ChangeTracker: Event-driven sync (debounce-based instead of timer)
 * - SyncWebSocketClient: Real-time lock notifications from backend
 *
 * USAGE:
 * ```typescript
 * import { syncCoordinator } from "@/lib/sync";
 *
 * // Initialize coordinator with auth token for WebSocket
 * syncCoordinator.initialize({
 *   projectId: "xxx",
 *   enabled: true,
 *   authToken: "jwt-token",
 * });
 *
 * // Register save function (now includes version handling)
 * syncCoordinator.registerSaveFunction(async (expectedVersion) => {
 *   const result = await api.saveProject(data, expectedVersion);
 *   return {
 *     success: result.ok,
 *     newVersion: result.version,
 *     isConflict: result.status === 409,
 *     serverVersion: result.serverVersion,
 *   };
 * });
 *
 * // Register reload function
 * syncCoordinator.registerReloadFunction(async () => {
 *   const project = await api.getProject(projectId);
 *   return { version: project.version };
 * });
 *
 * // Track changes (replaces scheduleSave)
 * syncCoordinator.trackChange({
 *   entityType: "state",
 *   entityId: "abc",
 *   changeType: "update",
 *   timestamp: Date.now(),
 * });
 *
 * // Subscribe to sync status
 * const unsubscribe = syncCoordinator.subscribe((status) => {
 *   console.log("Sync state:", status.state);
 *   console.log("Is locked:", status.state === "locked");
 * });
 * ```
 */

// Core coordinator
export { syncCoordinator } from "./sync-coordinator";
export type {
  SyncStatus,
  SyncCoordinatorConfig,
  SyncStatusListener,
  SaveFunction,
  ReloadFunction,
  ConfigurationGetter,
} from "./sync-coordinator";

// State machine
export { createSyncStateMachine } from "./sync-state-machine";
export type {
  SyncState,
  SyncContext,
  SyncEvent,
  SyncStateListener,
  SyncStateMachine,
} from "./sync-state-machine";

// Version tracking
export { createVersionTracker } from "./version-tracker";
export type {
  VersionState,
  CanSaveResult,
  VersionListener,
  VersionTracker,
} from "./version-tracker";

// Change tracking
export { createChangeTracker } from "./change-tracker";
export type {
  EntityType,
  ChangeType,
  ChangeEvent,
  ChangeTrackerConfig,
  ChangeTrackerStatus,
  StatusListener,
  ChangeTracker,
} from "./change-tracker";

// WebSocket client
export { createSyncWebSocketClient } from "./sync-websocket";
export type {
  SyncWebSocketEvent,
  SyncWebSocketEventType,
  ConnectionState,
  SyncEventHandler,
  ConnectionStateHandler,
  SyncWebSocketConfig,
  SyncWebSocketClient,
} from "./sync-websocket";

// Legacy exports (for backward compatibility)
export { debounceManager, DEBOUNCE_TIMERS } from "./debounce-manager";
export type { DebounceConfig } from "./debounce-manager";

export { conflictResolver } from "./conflict-resolver";
export type {
  ConflictStrategy,
  ConflictInfo,
  ResolutionResult,
  ConflictResolverConfig,
} from "./conflict-resolver";
