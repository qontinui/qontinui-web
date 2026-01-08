/**
 * Version Tracker
 *
 * Implements optimistic concurrency control for project sync.
 * Tracks local, server, and base versions to detect conflicts
 * and enable conditional updates.
 *
 * Version Strategy:
 * - localVersion: Incremented on every local change
 * - serverVersion: Last known server version (from API responses)
 * - baseVersion: Version when data was last loaded from server
 *
 * A write is considered "stale" if baseVersion !== serverVersion,
 * meaning someone else modified the data since we last loaded it.
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Version state
 */
export interface VersionState {
  /** Local version - incremented on every local change */
  localVersion: number;
  /** Last known server version */
  serverVersion: number | null;
  /** Version when data was last loaded from server */
  baseVersion: number | null;
  /** Whether there are unsynced local changes */
  dirty: boolean;
  /** Timestamp of last version update */
  lastUpdatedAt: Date;
}

/**
 * Result of canSave check
 */
export interface CanSaveResult {
  canSave: boolean;
  reason?: "not_dirty" | "no_base_version" | "stale" | "version_mismatch";
  serverVersion?: number;
  baseVersion?: number;
}

/**
 * Version update from server
 */
export interface ServerVersionUpdate {
  version: number;
  isReload: boolean; // True if this is from a full reload, false if from a save response
}

/**
 * Version tracker listener
 */
export type VersionListener = (state: VersionState) => void;

/**
 * Version Tracker implementation
 */
class VersionTrackerImpl {
  private state: VersionState = {
    localVersion: 0,
    serverVersion: null,
    baseVersion: null,
    dirty: false,
    lastUpdatedAt: new Date(),
  };

  private listeners: Set<VersionListener> = new Set();

  /**
   * Get current version state
   */
  getState(): VersionState {
    return { ...this.state };
  }

  /**
   * Mark as dirty (local change occurred)
   */
  markDirty(): void {
    this.state = {
      ...this.state,
      localVersion: this.state.localVersion + 1,
      dirty: true,
      lastUpdatedAt: new Date(),
    };
    this.notifyListeners();

    projectLogger.debug("VersionTracker", "Marked dirty", {
      localVersion: this.state.localVersion,
    });
  }

  /**
   * Mark as clean (changes were saved)
   */
  markClean(): void {
    this.state = {
      ...this.state,
      dirty: false,
      lastUpdatedAt: new Date(),
    };
    this.notifyListeners();
  }

  /**
   * Update server version after successful save
   */
  updateServerVersion(version: number): void {
    this.state = {
      ...this.state,
      serverVersion: version,
      baseVersion: version, // After save, base = server
      dirty: false,
      lastUpdatedAt: new Date(),
    };
    this.notifyListeners();

    projectLogger.debug("VersionTracker", "Server version updated (save)", {
      version,
      localVersion: this.state.localVersion,
    });
  }

  /**
   * Update versions after reload from server
   */
  updateFromReload(version: number): void {
    this.state = {
      ...this.state,
      localVersion: version, // Reset local to server version
      serverVersion: version,
      baseVersion: version,
      dirty: false,
      lastUpdatedAt: new Date(),
    };
    this.notifyListeners();

    projectLogger.debug("VersionTracker", "Versions updated (reload)", {
      version,
    });
  }

  /**
   * Update server version from external source (e.g., WebSocket notification)
   */
  updateServerVersionExternal(version: number): void {
    const previousServerVersion = this.state.serverVersion;
    this.state = {
      ...this.state,
      serverVersion: version,
      lastUpdatedAt: new Date(),
    };
    this.notifyListeners();

    projectLogger.debug("VersionTracker", "Server version updated (external)", {
      previousVersion: previousServerVersion,
      newVersion: version,
      isStale: this.isStale(),
    });
  }

  /**
   * Check if local changes can be saved
   * Returns detailed reason if save is not allowed
   */
  canSave(): CanSaveResult {
    // Nothing to save
    if (!this.state.dirty) {
      return { canSave: false, reason: "not_dirty" };
    }

    // No base version - first save or just reloaded
    if (this.state.baseVersion === null) {
      // Allow save if we have dirty changes but no base version yet
      // This can happen on first project creation
      return { canSave: true };
    }

    // Check if our base is still current
    if (
      this.state.serverVersion !== null &&
      this.state.baseVersion !== this.state.serverVersion
    ) {
      return {
        canSave: false,
        reason: "stale",
        serverVersion: this.state.serverVersion,
        baseVersion: this.state.baseVersion,
      };
    }

    return { canSave: true };
  }

  /**
   * Get expected version for conditional update API call
   * Returns null if no conditional update should be performed
   */
  getExpectedVersion(): number | null {
    return this.state.baseVersion;
  }

  /**
   * Check if local data is stale (server has newer version)
   */
  isStale(): boolean {
    if (this.state.baseVersion === null || this.state.serverVersion === null) {
      return false;
    }
    return this.state.baseVersion < this.state.serverVersion;
  }

  /**
   * Check if there are unsaved changes
   */
  isDirty(): boolean {
    return this.state.dirty;
  }

  /**
   * Get local version
   */
  getLocalVersion(): number {
    return this.state.localVersion;
  }

  /**
   * Get server version
   */
  getServerVersion(): number | null {
    return this.state.serverVersion;
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = {
      localVersion: 0,
      serverVersion: null,
      baseVersion: null,
      dirty: false,
      lastUpdatedAt: new Date(),
    };
    this.notifyListeners();

    projectLogger.debug("VersionTracker", "Reset");
  }

  /**
   * Subscribe to version changes
   */
  subscribe(listener: VersionListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("[VersionTracker] Error in listener:", error);
      }
    }
  }
}

/**
 * Create a new version tracker instance
 */
export function createVersionTracker(): VersionTrackerImpl {
  return new VersionTrackerImpl();
}

export type VersionTracker = VersionTrackerImpl;
