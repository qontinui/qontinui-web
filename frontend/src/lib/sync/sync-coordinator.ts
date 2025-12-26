/**
 * Sync Coordinator
 *
 * Unified orchestrator for all sync operations in the application.
 * Consolidates local saves, backend syncs, and offline queue processing.
 *
 * RESPONSIBILITIES:
 * 1. Debounce writes (500ms local, 5s backend)
 * 2. Queue offline operations
 * 3. Handle conflict resolution
 * 4. Manage beforeunload saves
 * 5. Track sync status for UI
 */

import { debounceManager, DEBOUNCE_TIMERS } from "./debounce-manager";
import { projectLogger } from "@/lib/project-logger";

/**
 * Sync status for UI display
 */
export interface SyncStatus {
  /** Whether any sync operation is in progress */
  isSyncing: boolean;
  /** Whether there are pending local changes */
  hasPendingLocalChanges: boolean;
  /** Whether there are pending backend changes */
  hasPendingBackendChanges: boolean;
  /** Last successful sync timestamp */
  lastSyncedAt: Date | null;
  /** Last error if any */
  lastError: Error | null;
  /** Number of pending offline operations */
  pendingOfflineOperations: number;
}

/**
 * Configuration for the sync coordinator
 */
export interface SyncCoordinatorConfig {
  /** Project ID for backend sync */
  projectId: string | null;
  /** Whether sync is enabled */
  enabled: boolean;
  /** Interval for auto-save to backend (ms) */
  backendSaveInterval: number;
  /** Cooldown after immediate save before auto-save (ms) */
  immediateSaveCooldown: number;
}

/**
 * Listener for sync status changes
 */
export type SyncStatusListener = (status: SyncStatus) => void;

/**
 * Save function type
 */
export type SaveFunction = () => Promise<void>;

/**
 * Configuration getter function type
 */
export type ConfigurationGetter = () => Record<string, unknown>;

class SyncCoordinatorImpl {
  private config: SyncCoordinatorConfig = {
    projectId: null,
    enabled: true,
    backendSaveInterval: 10000,
    immediateSaveCooldown: 2000,
  };

  private status: SyncStatus = {
    isSyncing: false,
    hasPendingLocalChanges: false,
    hasPendingBackendChanges: false,
    lastSyncedAt: null,
    lastError: null,
    pendingOfflineOperations: 0,
  };

  private listeners: Set<SyncStatusListener> = new Set();
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private lastImmediateSaveTime = 0;
  private isLoadingFromBackend = false;

  // Callbacks for actual save operations
  private saveToBackendFn: SaveFunction | null = null;
  private getConfigurationFn: ConfigurationGetter | null = null;

  /**
   * Initialize the coordinator with configuration
   */
  initialize(config: Partial<SyncCoordinatorConfig>): void {
    this.config = { ...this.config, ...config };
    this.setupAutoSave();
    this.setupBeforeUnload();
    projectLogger.info("SyncCoordinator", "Initialized", {
      config: this.config,
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SyncCoordinatorConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };

    // Restart auto-save if interval changed
    if (oldConfig.backendSaveInterval !== this.config.backendSaveInterval) {
      this.setupAutoSave();
    }

    projectLogger.debug("SyncCoordinator", "Config updated", {
      config: this.config,
    });
  }

  /**
   * Register the save function
   */
  registerSaveFunction(fn: SaveFunction): void {
    this.saveToBackendFn = fn;
  }

  /**
   * Register the configuration getter
   */
  registerConfigurationGetter(fn: ConfigurationGetter): void {
    this.getConfigurationFn = fn;
  }

  /**
   * Set loading from backend state
   */
  setLoadingFromBackend(loading: boolean): void {
    this.isLoadingFromBackend = loading;
  }

  /**
   * Mark that an immediate save occurred
   */
  markImmediateSave(): void {
    this.lastImmediateSaveTime = Date.now();
  }

  /**
   * Schedule a debounced save to backend
   */
  scheduleSave(): void {
    if (!this.config.enabled || !this.config.projectId) return;

    this.status.hasPendingBackendChanges = true;
    this.notifyListeners();

    debounceManager.schedule(DEBOUNCE_TIMERS.BACKEND_SAVE, async () => {
      await this.saveToBackend();
    });
  }

  /**
   * Perform an immediate save to backend
   */
  async saveNow(): Promise<void> {
    this.markImmediateSave();
    await this.saveToBackend();
  }

  /**
   * Save to backend
   */
  private async saveToBackend(): Promise<void> {
    // Don't save while loading from backend
    if (this.isLoadingFromBackend) {
      projectLogger.debug(
        "SyncCoordinator",
        "Skipping save - loading from backend"
      );
      return;
    }

    // Check cooldown after immediate save
    const timeSinceImmediateSave = Date.now() - this.lastImmediateSaveTime;
    if (
      this.lastImmediateSaveTime > 0 &&
      timeSinceImmediateSave < this.config.immediateSaveCooldown
    ) {
      projectLogger.debug(
        "SyncCoordinator",
        "Skipping save - recent immediate save",
        { timeSinceImmediateSave, cooldown: this.config.immediateSaveCooldown }
      );
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
        ((config.images as unknown[])?.length ?? 0) > 0;

      if (!hasData) {
        projectLogger.debug(
          "SyncCoordinator",
          "Skipping save - configuration empty"
        );
        return;
      }
    }

    this.status.isSyncing = true;
    this.notifyListeners();

    try {
      projectLogger.debug("SyncCoordinator", "Saving to backend", {
        projectId: this.config.projectId,
      });

      await this.saveToBackendFn();

      this.status.lastSyncedAt = new Date();
      this.status.lastError = null;
      this.status.hasPendingBackendChanges = false;

      projectLogger.debug("SyncCoordinator", "Save complete");
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error : new Error("Unknown error");
      projectLogger.error("SyncCoordinator", "Save failed", {
        error: this.status.lastError.message,
      });
    } finally {
      this.status.isSyncing = false;
      this.notifyListeners();
    }
  }

  /**
   * Set up auto-save interval
   */
  private setupAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    if (!this.config.enabled) return;

    this.autoSaveInterval = setInterval(() => {
      if (this.config.projectId && this.status.hasPendingBackendChanges) {
        this.saveToBackend();
      }
    }, this.config.backendSaveInterval);
  }

  /**
   * Set up beforeunload handler
   */
  private setupBeforeUnload(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("beforeunload", () => {
      this.handleBeforeUnload();
    });
  }

  /**
   * Handle page unload - save with keepalive
   */
  private handleBeforeUnload(): void {
    if (!this.config.enabled || !this.config.projectId) return;

    // Flush all pending debounced operations
    debounceManager.flushAll();

    // Get configuration if available
    if (!this.getConfigurationFn) return;

    const config = this.getConfigurationFn();
    const hasData =
      ((config.workflows as unknown[])?.length ?? 0) > 0 ||
      ((config.states as unknown[])?.length ?? 0) > 0 ||
      ((config.transitions as unknown[])?.length ?? 0) > 0 ||
      ((config.images as unknown[])?.length ?? 0) > 0;

    if (!hasData) return;

    projectLogger.debug("SyncCoordinator", "Saving on beforeunload", {
      projectId: this.config.projectId,
    });

    // Use fetch with keepalive for reliable delivery during page unload
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const url = `${backendUrl}/api/v1/projects/${this.config.projectId}`;

    fetch(url, {
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

  /**
   * Subscribe to sync status changes
   */
  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    // Immediately notify with current status
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /**
   * Notify all listeners of status changes
   */
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

  /**
   * Destroy the coordinator (cleanup)
   */
  destroy(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
    debounceManager.cancelAll();
    this.listeners.clear();
  }
}

// Export singleton instance
export const syncCoordinator = new SyncCoordinatorImpl();
