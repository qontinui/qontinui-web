/**
 * Sync Coordinator
 *
 * Unified orchestrator for all sync operations in the application.
 * Uses a state machine for predictable sync behavior and coordinates
 * between local edits, backend saves, and operation locks.
 *
 * ARCHITECTURE:
 * - SyncStateMachine: Manages sync state transitions (idle, editing, saving, locked, etc.)
 * - VersionTracker: Optimistic concurrency control with version vectors
 * - ChangeTracker: Event-driven sync (debounce-based instead of timer)
 * - SyncWebSocketClient: Real-time lock notifications from backend
 *
 * KEY BEHAVIORS:
 * - When locked by backend operation: Pause local sync, discard pending changes
 * - When lock released: Auto-reload to get fresh data
 * - Version conflicts (409): Transition to conflict state for resolution
 * - Event-driven saves: 2s debounce after last change, 30s max delay
 */

import { projectLogger } from "@/lib/project-logger";
import {
  createSyncStateMachine,
  type SyncStateMachine,
  type SyncState,
} from "./sync-state-machine";
import { createVersionTracker, type VersionTracker } from "./version-tracker";
import {
  createChangeTracker,
  type ChangeTracker,
  type ChangeEvent,
  type ChangeTrackerConfig,
} from "./change-tracker";
import {
  createSyncWebSocketClient,
  type SyncWebSocketClient,
  type SyncWebSocketEvent,
  type ConnectionState,
} from "./sync-websocket";

/**
 * Sync status for UI display
 */
export interface SyncStatus {
  /** Current sync state */
  state: SyncState;
  /** Whether any sync operation is in progress */
  isSyncing: boolean;
  /** Whether saves are blocked (locked, reloading, conflict) */
  isSaveBlocked: boolean;
  /** Whether there are pending local changes */
  hasPendingChanges: boolean;
  /** Last successful sync timestamp */
  lastSyncedAt: Date | null;
  /** Last error if any */
  lastError: string | null;
  /** Active lock operation if locked */
  activeOperation: string | null;
  /** WebSocket connection state */
  connectionState: ConnectionState;
  /** Local version */
  localVersion: number;
  /** Server version */
  serverVersion: number | null;
  /** Whether local data is stale */
  isStale: boolean;
}

/**
 * Configuration for the sync coordinator
 */
export interface SyncCoordinatorConfig {
  /** Project ID for sync */
  projectId: string | null;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Auth token for WebSocket */
  authToken: string | null;
  /** Change tracker settings */
  changeTracker?: Partial<ChangeTrackerConfig>;
}

/**
 * Listener for sync status changes
 */
export type SyncStatusListener = (status: SyncStatus) => void;

/**
 * Save function type - returns new version on success
 */
export type SaveFunction = (expectedVersion: number | null) => Promise<{
  success: boolean;
  newVersion?: number;
  error?: string;
  isConflict?: boolean;
  serverVersion?: number;
}>;

/**
 * Reload function type - returns version after reload
 */
export type ReloadFunction = () => Promise<{ version: number }>;

/**
 * Configuration getter function type
 */
export type ConfigurationGetter = () => Record<string, unknown>;

class SyncCoordinatorImpl {
  private config: SyncCoordinatorConfig = {
    projectId: null,
    enabled: true,
    authToken: null,
  };

  // Core components
  private stateMachine: SyncStateMachine;
  private versionTracker: VersionTracker;
  private changeTracker: ChangeTracker;
  private wsClient: SyncWebSocketClient;

  // Listeners
  private listeners: Set<SyncStatusListener> = new Set();

  // Callbacks for actual operations
  private saveToBackendFn: SaveFunction | null = null;
  private reloadFromBackendFn: ReloadFunction | null = null;
  private getConfigurationFn: ConfigurationGetter | null = null;

  // BeforeUnload handler reference
  private boundBeforeUnload: (() => void) | null = null;

  constructor() {
    this.stateMachine = createSyncStateMachine();
    this.versionTracker = createVersionTracker();
    this.changeTracker = createChangeTracker();
    this.wsClient = createSyncWebSocketClient();

    this.setupInternalListeners();
  }

  /**
   * Initialize the coordinator with configuration
   */
  initialize(config: Partial<SyncCoordinatorConfig>): void {
    this.config = { ...this.config, ...config };

    // Configure change tracker
    if (config.changeTracker) {
      this.changeTracker.updateConfig(config.changeTracker);
    }

    // Set up change tracker flush callback
    this.changeTracker.setFlushCallback(async () => {
      await this.performSave();
    });

    // Start change tracker
    this.changeTracker.start();

    // Connect WebSocket if project ID provided
    if (config.projectId && config.authToken) {
      this.wsClient.setAuthToken(config.authToken);
      this.wsClient.connect(config.projectId);
      this.stateMachine.send({
        type: "SET_PROJECT",
        projectId: config.projectId,
      });
    }

    this.setupBeforeUnload();

    projectLogger.info("SyncCoordinator", "Initialized", {
      projectId: config.projectId,
      enabled: this.config.enabled,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SyncCoordinatorConfig>): void {
    const oldProjectId = this.config.projectId;
    this.config = { ...this.config, ...config };

    // Reconnect WebSocket if project changed
    if (config.projectId && config.projectId !== oldProjectId) {
      if (config.authToken || this.config.authToken) {
        this.wsClient.setAuthToken(config.authToken ?? this.config.authToken);
        this.wsClient.connect(config.projectId);
        this.stateMachine.send({
          type: "SET_PROJECT",
          projectId: config.projectId,
        });
      }
    }

    if (config.changeTracker) {
      this.changeTracker.updateConfig(config.changeTracker);
    }

    projectLogger.debug("SyncCoordinator", "Config updated", {
      projectId: this.config.projectId,
    });
  }

  /**
   * Register the save function
   */
  registerSaveFunction(fn: SaveFunction): void {
    this.saveToBackendFn = fn;
  }

  /**
   * Register the reload function
   */
  registerReloadFunction(fn: ReloadFunction): void {
    this.reloadFromBackendFn = fn;
  }

  /**
   * Register the configuration getter
   */
  registerConfigurationGetter(fn: ConfigurationGetter): void {
    this.getConfigurationFn = fn;
  }

  /**
   * Track a change (replaces scheduleSave)
   */
  trackChange(event: ChangeEvent): void {
    if (!this.config.enabled || !this.config.projectId) return;

    // Check if edits are blocked
    if (this.stateMachine.isEditBlocked()) {
      projectLogger.warn("SyncCoordinator", "Edit blocked", {
        state: this.stateMachine.getState(),
        operation: this.stateMachine.getContext().activeOperation,
      });
      return;
    }

    // Track in version tracker
    this.versionTracker.markDirty();

    // Notify state machine
    this.stateMachine.send({ type: "USER_EDIT" });

    // Track in change tracker (will debounce and flush)
    this.changeTracker.trackChange(event);
  }

  /**
   * Force immediate save
   */
  async saveNow(): Promise<boolean> {
    if (this.stateMachine.isSaveBlocked()) {
      projectLogger.warn("SyncCoordinator", "Save blocked", {
        state: this.stateMachine.getState(),
      });
      return false;
    }

    // Flush change tracker immediately
    try {
      await this.changeTracker.flushNow();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Force reload from backend
   */
  async reload(): Promise<boolean> {
    return this.performReload();
  }

  /**
   * Set loading from backend state (legacy compatibility)
   * @deprecated Use state machine events instead
   */
  setLoadingFromBackend(loading: boolean): void {
    if (loading) {
      this.stateMachine.send({ type: "RELOAD_STARTED" });
    } else {
      // Get current server version from tracker
      const version = this.versionTracker.getServerVersion() ?? 0;
      this.stateMachine.send({ type: "RELOAD_COMPLETED", version });
    }
  }

  /**
   * Mark that an immediate save occurred (legacy compatibility)
   * @deprecated Now handled by ChangeTracker
   */
  markImmediateSave(): void {
    // No-op for legacy compatibility
  }

  /**
   * Schedule a debounced save (legacy compatibility)
   * @deprecated Use trackChange instead
   */
  scheduleSave(): void {
    // Track a generic change for legacy callers
    this.trackChange({
      entityType: "settings",
      entityId: "legacy",
      changeType: "update",
      timestamp: Date.now(),
    });
  }

  /**
   * Get sync state machine (for advanced usage)
   */
  getStateMachine(): SyncStateMachine {
    return this.stateMachine;
  }

  /**
   * Get version tracker (for advanced usage)
   */
  getVersionTracker(): VersionTracker {
    return this.versionTracker;
  }

  /**
   * Get change tracker (for advanced usage)
   */
  getChangeTracker(): ChangeTracker {
    return this.changeTracker;
  }

  /**
   * Subscribe to sync status changes
   */
  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    const context = this.stateMachine.getContext();
    const versionState = this.versionTracker.getState();

    return {
      state: context.state,
      isSyncing: this.stateMachine.isSyncing(),
      isSaveBlocked: this.stateMachine.isSaveBlocked(),
      hasPendingChanges:
        this.changeTracker.hasPendingChanges() || versionState.dirty,
      lastSyncedAt: context.lastSyncedAt,
      lastError: context.error,
      activeOperation: context.activeOperation,
      connectionState: this.wsClient.getConnectionState(),
      localVersion: versionState.localVersion,
      serverVersion: versionState.serverVersion,
      isStale: this.versionTracker.isStale(),
    };
  }

  /**
   * Check if saves are blocked (for use in other components)
   */
  isSaveBlocked(): boolean {
    return this.stateMachine.isSaveBlocked();
  }

  /**
   * Check if edits are blocked (for use in other components)
   */
  isEditBlocked(): boolean {
    return this.stateMachine.isEditBlocked();
  }

  /**
   * Get expected version for API calls
   */
  getExpectedVersion(): number | null {
    return this.versionTracker.getExpectedVersion();
  }

  /**
   * Update server version after successful API response
   */
  updateServerVersion(version: number, isReload: boolean = false): void {
    if (isReload) {
      this.versionTracker.updateFromReload(version);
    } else {
      this.versionTracker.updateServerVersion(version);
    }
    this.notifyListeners();
  }

  /**
   * Destroy the coordinator (cleanup)
   */
  destroy(): void {
    this.changeTracker.stop();
    this.wsClient.disconnect();

    if (this.boundBeforeUnload && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.boundBeforeUnload);
    }

    this.listeners.clear();
    this.versionTracker.reset();
    this.stateMachine.send({ type: "RESET" });

    projectLogger.debug("SyncCoordinator", "Destroyed");
  }

  // Private methods

  private setupInternalListeners(): void {
    // Listen to state machine changes
    this.stateMachine.subscribe(() => {
      this.notifyListeners();
    });

    // Listen to version tracker changes
    this.versionTracker.subscribe(() => {
      this.notifyListeners();
    });

    // Listen to change tracker changes
    this.changeTracker.subscribe(() => {
      this.notifyListeners();
    });

    // Listen to WebSocket events
    this.wsClient.onEvent((event) => {
      this.handleWebSocketEvent(event);
    });

    // Listen to WebSocket connection state
    this.wsClient.onConnectionState(() => {
      this.notifyListeners();
    });
  }

  private handleWebSocketEvent(event: SyncWebSocketEvent): void {
    switch (event.type) {
      case "LOCK_ACQUIRED":
        projectLogger.info("SyncCoordinator", "Lock acquired via WebSocket", {
          lockId: event.lockId,
          operation: event.operation,
          userId: event.userId,
        });

        // Cancel pending changes - backend is authoritative
        this.changeTracker.cancel();
        this.versionTracker.markClean();

        // Transition to locked state
        this.stateMachine.send({
          type: "LOCK_ACQUIRED",
          lockId: event.lockId,
          operation: event.operation,
          userId: event.userId,
        });
        break;

      case "LOCK_RELEASED":
        projectLogger.info("SyncCoordinator", "Lock released via WebSocket", {
          lockId: event.lockId,
          newVersion: event.newVersion,
        });

        // Update server version
        this.versionTracker.updateServerVersionExternal(event.newVersion);

        // Transition to reloading (will trigger reload)
        this.stateMachine.send({
          type: "LOCK_RELEASED",
          lockId: event.lockId,
          newVersion: event.newVersion,
        });

        // Auto-reload to get new data
        this.performReload();
        break;

      case "VERSION_UPDATED":
        projectLogger.debug(
          "SyncCoordinator",
          "Version updated via WebSocket",
          {
            version: event.version,
            source: event.source,
          }
        );

        // Update server version (but don't reload automatically)
        this.versionTracker.updateServerVersionExternal(event.version);
        break;

      case "CONFLICT":
        projectLogger.warn(
          "SyncCoordinator",
          "Conflict detected via WebSocket",
          {
            localVersion: event.localVersion,
            serverVersion: event.serverVersion,
          }
        );

        this.stateMachine.send({
          type: "CONFLICT_DETECTED",
          localVersion: event.localVersion,
          serverVersion: event.serverVersion,
        });
        break;

      case "ERROR":
        projectLogger.error("SyncCoordinator", "WebSocket error", {
          message: event.message,
        });
        break;
    }
  }

  private async performSave(): Promise<void> {
    // Check if save is allowed
    if (this.stateMachine.isSaveBlocked()) {
      projectLogger.debug("SyncCoordinator", "Save blocked by state machine", {
        state: this.stateMachine.getState(),
      });
      return;
    }

    const canSaveResult = this.versionTracker.canSave();
    if (!canSaveResult.canSave) {
      projectLogger.debug(
        "SyncCoordinator",
        "Save blocked by version tracker",
        {
          reason: canSaveResult.reason,
        }
      );

      if (canSaveResult.reason === "stale") {
        // Our data is stale - trigger conflict
        this.stateMachine.send({
          type: "CONFLICT_DETECTED",
          localVersion: this.versionTracker.getLocalVersion(),
          serverVersion: canSaveResult.serverVersion!,
        });
      }
      return;
    }

    if (!this.config.projectId || !this.saveToBackendFn) {
      return;
    }

    // Check for empty configuration
    if (this.getConfigurationFn) {
      const config = this.getConfigurationFn();
      const hasData =
        ((config.workflows as unknown[])?.length ?? 0) > 0 ||
        ((config.states as unknown[])?.length ?? 0) > 0 ||
        ((config.transitions as unknown[])?.length ?? 0) > 0 ||
        ((config.images as unknown[])?.length ?? 0) > 0 ||
        ((config.contexts as unknown[])?.length ?? 0) > 0;

      if (!hasData) {
        projectLogger.debug(
          "SyncCoordinator",
          "Skip save - configuration empty"
        );
        return;
      }
    }

    // Transition to saving state
    const expectedVersion = this.versionTracker.getExpectedVersion();
    this.stateMachine.send({
      type: "SAVE_STARTED",
      version: this.versionTracker.getLocalVersion(),
    });

    projectLogger.debug("SyncCoordinator", "Saving to backend", {
      projectId: this.config.projectId,
      expectedVersion,
    });

    try {
      const result = await this.saveToBackendFn(expectedVersion);

      if (result.success && result.newVersion !== undefined) {
        // Save succeeded
        this.versionTracker.updateServerVersion(result.newVersion);
        this.stateMachine.send({
          type: "SAVE_COMPLETED",
          newVersion: result.newVersion,
        });

        projectLogger.debug("SyncCoordinator", "Save completed", {
          newVersion: result.newVersion,
        });
      } else if (result.isConflict && result.serverVersion !== undefined) {
        // Version conflict (409)
        this.stateMachine.send({
          type: "SAVE_REJECTED",
          serverVersion: result.serverVersion,
        });

        projectLogger.warn(
          "SyncCoordinator",
          "Save rejected - version conflict",
          {
            expectedVersion,
            serverVersion: result.serverVersion,
          }
        );
      } else {
        // Other error
        this.stateMachine.send({
          type: "ERROR",
          error: result.error ?? "Unknown save error",
        });

        projectLogger.error("SyncCoordinator", "Save failed", {
          error: result.error,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.stateMachine.send({ type: "ERROR", error: errorMessage });

      projectLogger.error("SyncCoordinator", "Save error", {
        error: errorMessage,
      });
      throw error;
    }
  }

  private async performReload(): Promise<boolean> {
    if (!this.reloadFromBackendFn) {
      projectLogger.warn("SyncCoordinator", "No reload function registered");
      return false;
    }

    // Cancel pending changes
    this.changeTracker.cancel();

    // Transition to reloading state
    this.stateMachine.send({ type: "RELOAD_STARTED" });

    projectLogger.debug("SyncCoordinator", "Reloading from backend");

    try {
      const result = await this.reloadFromBackendFn();

      // Update version tracker
      this.versionTracker.updateFromReload(result.version);

      // Complete reload
      this.stateMachine.send({
        type: "RELOAD_COMPLETED",
        version: result.version,
      });

      projectLogger.debug("SyncCoordinator", "Reload completed", {
        version: result.version,
      });

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.stateMachine.send({ type: "ERROR", error: errorMessage });

      projectLogger.error("SyncCoordinator", "Reload failed", {
        error: errorMessage,
      });

      return false;
    }
  }

  private setupBeforeUnload(): void {
    if (typeof window === "undefined") return;

    this.boundBeforeUnload = () => {
      this.handleBeforeUnload();
    };

    window.addEventListener("beforeunload", this.boundBeforeUnload);
  }

  private handleBeforeUnload(): void {
    if (!this.config.enabled || !this.config.projectId) return;

    // Get configuration if available
    if (!this.getConfigurationFn) return;

    const config = this.getConfigurationFn();
    const hasData =
      ((config.workflows as unknown[])?.length ?? 0) > 0 ||
      ((config.states as unknown[])?.length ?? 0) > 0 ||
      ((config.transitions as unknown[])?.length ?? 0) > 0 ||
      ((config.images as unknown[])?.length ?? 0) > 0 ||
      ((config.contexts as unknown[])?.length ?? 0) > 0;

    if (!hasData) return;

    // Only save if we have pending changes
    if (!this.versionTracker.isDirty()) return;

    projectLogger.debug("SyncCoordinator", "Saving on beforeunload", {
      projectId: this.config.projectId,
    });

    // Use fetch with keepalive for reliable delivery during page unload
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const url = `${backendUrl}/api/v1/projects/${this.config.projectId}`;

    // Include expected version for conditional update
    const expectedVersion = this.versionTracker.getExpectedVersion();
    const urlWithVersion =
      expectedVersion !== null
        ? `${url}?expected_version=${expectedVersion}`
        : url;

    fetch(urlWithVersion, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ configuration: config }),
      keepalive: true,
      credentials: "include",
    }).catch(() => {
      // Ignore errors during unload - best effort save
    });
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        console.error("[SyncCoordinator] Error in listener:", error);
      }
    }
  }
}

// Export singleton instance
export const syncCoordinator = new SyncCoordinatorImpl();
