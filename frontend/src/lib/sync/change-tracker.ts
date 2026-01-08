/**
 * Change Tracker
 *
 * Tracks local changes and triggers sync based on change events rather than
 * a fixed timer. Provides intelligent debouncing with configurable thresholds.
 *
 * Features:
 * - Track changes by entity type (workflow, state, transition, image)
 * - Debounce: Wait for activity to settle before syncing
 * - Max delay: Force sync after threshold even if activity continues
 * - Max pending: Force sync when too many changes accumulate
 * - Immediate flush: Cancel debounce and sync now
 * - Cancel: Abort pending sync (e.g., when lock acquired)
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Entity types that can be changed
 */
export type EntityType =
  | "workflow"
  | "state"
  | "transition"
  | "image"
  | "settings"
  | "context";

/**
 * Change types
 */
export type ChangeType = "create" | "update" | "delete";

/**
 * A tracked change event
 */
export interface ChangeEvent {
  entityType: EntityType;
  entityId: string;
  changeType: ChangeType;
  timestamp: number;
}

/**
 * Change tracker configuration
 */
export interface ChangeTrackerConfig {
  /** Debounce delay - wait this long after last change before flushing (ms) */
  debounceDelay: number;
  /** Max delay - force flush after this time even if changes continue (ms) */
  maxDelay: number;
  /** Max pending changes - force flush when this many changes accumulate */
  maxPendingChanges: number;
  /** Fallback interval - periodic check even if no changes (ms), 0 to disable */
  fallbackInterval: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ChangeTrackerConfig = {
  debounceDelay: 2000, // 2 seconds after last change
  maxDelay: 30000, // 30 seconds max
  maxPendingChanges: 100, // Flush after 100 changes
  fallbackInterval: 60000, // 60 second fallback
};

/**
 * Flush callback type
 */
export type FlushCallback = (changes: ChangeEvent[]) => Promise<void>;

/**
 * Change tracker status
 */
export interface ChangeTrackerStatus {
  pendingChanges: number;
  oldestChangeAt: Date | null;
  lastFlushAt: Date | null;
  isWaiting: boolean;
  timeUntilFlush: number | null;
}

/**
 * Status listener callback
 */
export type StatusListener = (status: ChangeTrackerStatus) => void;

/**
 * Change Tracker implementation
 */
class ChangeTrackerImpl {
  private config: ChangeTrackerConfig;
  private pendingChanges: ChangeEvent[] = [];
  private debounceTimeout: NodeJS.Timeout | null = null;
  private maxDelayTimeout: NodeJS.Timeout | null = null;
  private fallbackInterval: NodeJS.Timeout | null = null;
  private onFlush: FlushCallback | null = null;
  private firstChangeAt: number | null = null;
  private lastFlushAt: Date | null = null;
  private isPaused: boolean = false;
  private listeners: Set<StatusListener> = new Set();

  constructor(config: Partial<ChangeTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the flush callback
   */
  setFlushCallback(callback: FlushCallback): void {
    this.onFlush = callback;
  }

  /**
   * Start the change tracker (enables fallback interval)
   */
  start(): void {
    this.setupFallbackInterval();
    projectLogger.debug("ChangeTracker", "Started", { config: this.config });
  }

  /**
   * Stop the change tracker
   */
  stop(): void {
    this.cancelAllTimers();
    projectLogger.debug("ChangeTracker", "Stopped");
  }

  /**
   * Track a change
   */
  trackChange(event: ChangeEvent): void {
    if (this.isPaused) {
      projectLogger.debug("ChangeTracker", "Change ignored (paused)", {
        event,
      });
      return;
    }

    this.pendingChanges.push(event);

    // Record first change time for max delay calculation
    if (this.firstChangeAt === null) {
      this.firstChangeAt = Date.now();
      this.startMaxDelayTimer();
    }

    // Check if we should force flush due to max pending changes
    if (this.pendingChanges.length >= this.config.maxPendingChanges) {
      projectLogger.debug(
        "ChangeTracker",
        "Max pending changes reached, flushing",
        {
          count: this.pendingChanges.length,
        }
      );
      this.flushNow();
      return;
    }

    // Reset debounce timer
    this.restartDebounceTimer();
    this.notifyListeners();

    projectLogger.debug("ChangeTracker", "Change tracked", {
      event,
      pendingCount: this.pendingChanges.length,
    });
  }

  /**
   * Track multiple changes at once
   */
  trackChanges(events: ChangeEvent[]): void {
    for (const event of events) {
      this.trackChange(event);
    }
  }

  /**
   * Force immediate flush
   */
  async flushNow(): Promise<void> {
    if (this.pendingChanges.length === 0) {
      return;
    }

    this.cancelDebounceTimer();
    this.cancelMaxDelayTimer();

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];
    this.firstChangeAt = null;
    this.lastFlushAt = new Date();

    this.notifyListeners();

    if (this.onFlush) {
      projectLogger.debug("ChangeTracker", "Flushing changes", {
        count: changes.length,
      });
      try {
        await this.onFlush(changes);
      } catch (error) {
        projectLogger.error("ChangeTracker", "Flush failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          changeCount: changes.length,
        });
        // Re-add changes on failure so they can be retried
        this.pendingChanges = [...changes, ...this.pendingChanges];
        this.firstChangeAt = changes[0]?.timestamp ?? null;
        this.notifyListeners();
        throw error;
      }
    }
  }

  /**
   * Cancel pending flush (e.g., when lock acquired)
   */
  cancel(): void {
    this.cancelDebounceTimer();
    this.cancelMaxDelayTimer();
    this.pendingChanges = [];
    this.firstChangeAt = null;
    this.notifyListeners();

    projectLogger.debug("ChangeTracker", "Cancelled");
  }

  /**
   * Pause tracking (changes will be ignored)
   */
  pause(): void {
    this.isPaused = true;
    this.cancelDebounceTimer();
    this.cancelMaxDelayTimer();
    projectLogger.debug("ChangeTracker", "Paused");
  }

  /**
   * Resume tracking
   */
  resume(): void {
    this.isPaused = false;
    projectLogger.debug("ChangeTracker", "Resumed");
  }

  /**
   * Discard all pending changes without flushing
   */
  discard(): void {
    this.cancel();
    projectLogger.debug("ChangeTracker", "Discarded all changes");
  }

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.pendingChanges.length > 0;
  }

  /**
   * Get pending change count
   */
  getPendingCount(): number {
    return this.pendingChanges.length;
  }

  /**
   * Get current status
   */
  getStatus(): ChangeTrackerStatus {
    const now = Date.now();
    let timeUntilFlush: number | null = null;

    if (this.debounceTimeout && this.firstChangeAt) {
      const debounceEnd = now + this.config.debounceDelay;
      const maxDelayEnd = this.firstChangeAt + this.config.maxDelay;
      timeUntilFlush = Math.min(debounceEnd, maxDelayEnd) - now;
    }

    return {
      pendingChanges: this.pendingChanges.length,
      oldestChangeAt: this.firstChangeAt ? new Date(this.firstChangeAt) : null,
      lastFlushAt: this.lastFlushAt,
      isWaiting: this.debounceTimeout !== null,
      timeUntilFlush,
    };
  }

  /**
   * Subscribe to status changes
   */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ChangeTrackerConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart fallback interval if changed
    if (config.fallbackInterval !== undefined) {
      this.setupFallbackInterval();
    }
  }

  // Private methods

  private restartDebounceTimer(): void {
    this.cancelDebounceTimer();

    this.debounceTimeout = setTimeout(() => {
      this.debounceTimeout = null;
      this.flushNow().catch((error) => {
        projectLogger.error("ChangeTracker", "Debounce flush failed", {
          error,
        });
      });
    }, this.config.debounceDelay);
  }

  private cancelDebounceTimer(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
  }

  private startMaxDelayTimer(): void {
    this.cancelMaxDelayTimer();

    this.maxDelayTimeout = setTimeout(() => {
      this.maxDelayTimeout = null;
      projectLogger.debug("ChangeTracker", "Max delay reached, flushing");
      this.flushNow().catch((error) => {
        projectLogger.error("ChangeTracker", "Max delay flush failed", {
          error,
        });
      });
    }, this.config.maxDelay);
  }

  private cancelMaxDelayTimer(): void {
    if (this.maxDelayTimeout) {
      clearTimeout(this.maxDelayTimeout);
      this.maxDelayTimeout = null;
    }
  }

  private setupFallbackInterval(): void {
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }

    if (this.config.fallbackInterval > 0) {
      this.fallbackInterval = setInterval(() => {
        if (this.pendingChanges.length > 0 && !this.isPaused) {
          projectLogger.debug("ChangeTracker", "Fallback interval triggered");
          this.flushNow().catch((error) => {
            projectLogger.error("ChangeTracker", "Fallback flush failed", {
              error,
            });
          });
        }
      }, this.config.fallbackInterval);
    }
  }

  private cancelAllTimers(): void {
    this.cancelDebounceTimer();
    this.cancelMaxDelayTimer();
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        console.error("[ChangeTracker] Error in listener:", error);
      }
    }
  }
}

/**
 * Create a new change tracker instance
 */
export function createChangeTracker(
  config?: Partial<ChangeTrackerConfig>
): ChangeTrackerImpl {
  return new ChangeTrackerImpl(config);
}

export type ChangeTracker = ChangeTrackerImpl;
