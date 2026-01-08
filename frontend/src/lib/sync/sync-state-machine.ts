/**
 * Sync State Machine
 *
 * Manages synchronization state transitions with predictable flow.
 * Prevents race conditions by enforcing valid state transitions and
 * coordinating between frontend edits and backend operations.
 *
 * State Flow:
 * IDLE ←→ EDITING ←→ SAVING → IDLE
 *   ↓        ↓          ↓
 *   └→ RELOADING ←──────┘
 *   ↓        ↓
 *   └→ LOCKED ─→ RELOADING
 *   ↓
 *   └→ CONFLICT → IDLE/RELOADING
 *   ↓
 *   └→ ERROR → IDLE
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Sync states
 */
export type SyncState =
  | "idle" // No sync activity, ready for changes
  | "editing" // Frontend is authoritative, local changes being made
  | "saving" // Frontend saving to backend
  | "reloading" // Backend is authoritative, fetching fresh data
  | "locked" // Backend operation in progress (e.g., import states)
  | "conflict" // Version mismatch detected
  | "error"; // Sync error occurred

/**
 * State machine context
 */
export interface SyncContext {
  /** Current state */
  state: SyncState;
  /** Project ID being synced */
  projectId: string | null;
  /** Local version (incremented on every change) */
  localVersion: number;
  /** Last known server version */
  serverVersion: number | null;
  /** Base version (when data was last loaded from server) */
  baseVersion: number | null;
  /** Whether there are pending unsaved changes */
  pendingChanges: boolean;
  /** Last successful sync timestamp */
  lastSyncedAt: Date | null;
  /** Active lock ID if in locked state */
  activeLockId: string | null;
  /** Description of locked operation */
  activeOperation: string | null;
  /** User ID who acquired the lock */
  lockOwnerId: string | null;
  /** Error message if in error state */
  error: string | null;
  /** Timestamp when current state was entered */
  stateEnteredAt: number;
}

/**
 * State transition events
 */
export type SyncEvent =
  | { type: "USER_EDIT" }
  | { type: "SAVE_REQUESTED" }
  | { type: "SAVE_STARTED"; version: number }
  | { type: "SAVE_COMPLETED"; newVersion: number }
  | { type: "SAVE_REJECTED"; serverVersion: number }
  | { type: "RELOAD_REQUESTED"; force?: boolean }
  | { type: "RELOAD_STARTED" }
  | { type: "RELOAD_COMPLETED"; version: number }
  | { type: "LOCK_ACQUIRED"; lockId: string; operation: string; userId: string }
  | { type: "LOCK_RELEASED"; lockId: string; newVersion?: number }
  | {
      type: "CONFLICT_DETECTED";
      localVersion: number;
      serverVersion: number;
    }
  | {
      type: "CONFLICT_RESOLVED";
      resolution: "local" | "server" | "merge";
      version: number;
    }
  | { type: "ERROR"; error: string }
  | { type: "RESET" }
  | { type: "SET_PROJECT"; projectId: string };

/**
 * State listener callback
 */
export type SyncStateListener = (context: SyncContext) => void;

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<SyncState, SyncState[]> = {
  idle: ["editing", "reloading", "locked", "error"],
  editing: ["saving", "reloading", "locked", "idle", "error"],
  saving: ["idle", "conflict", "error", "reloading", "locked"],
  reloading: ["idle", "editing", "error", "locked"],
  locked: ["reloading", "idle", "error"],
  conflict: ["idle", "reloading", "saving", "error"],
  error: ["idle", "editing", "reloading"],
};

/**
 * Initial context
 */
function createInitialContext(): SyncContext {
  return {
    state: "idle",
    projectId: null,
    localVersion: 0,
    serverVersion: null,
    baseVersion: null,
    pendingChanges: false,
    lastSyncedAt: null,
    activeLockId: null,
    activeOperation: null,
    lockOwnerId: null,
    error: null,
    stateEnteredAt: Date.now(),
  };
}

/**
 * Sync State Machine implementation
 */
class SyncStateMachineImpl {
  private context: SyncContext = createInitialContext();
  private listeners: Set<SyncStateListener> = new Set();

  /**
   * Get current context
   */
  getContext(): SyncContext {
    return { ...this.context };
  }

  /**
   * Get current state
   */
  getState(): SyncState {
    return this.context.state;
  }

  /**
   * Check if a transition is valid
   */
  canTransition(to: SyncState): boolean {
    return VALID_TRANSITIONS[this.context.state]?.includes(to) ?? false;
  }

  /**
   * Send an event to the state machine
   */
  send(event: SyncEvent): SyncContext {
    const previousState = this.context.state;

    switch (event.type) {
      case "SET_PROJECT":
        // Can set project from any state - resets to idle
        this.transition("idle", {
          projectId: event.projectId,
          localVersion: 0,
          serverVersion: null,
          baseVersion: null,
          pendingChanges: false,
          error: null,
        });
        break;

      case "USER_EDIT":
        // User made a local change
        if (this.context.state === "idle" || this.context.state === "editing") {
          this.transition("editing", {
            localVersion: this.context.localVersion + 1,
            pendingChanges: true,
          });
        } else if (this.context.state === "locked") {
          // Can't edit while locked - log warning
          projectLogger.warn(
            "SyncStateMachine",
            "Edit blocked - operation in progress",
            {
              operation: this.context.activeOperation,
              lockId: this.context.activeLockId,
            }
          );
        }
        break;

      case "SAVE_REQUESTED":
        // Save was triggered (debounced)
        if (this.canTransition("saving")) {
          // Don't transition yet - wait for SAVE_STARTED
          // This allows cancellation before actual save
        }
        break;

      case "SAVE_STARTED":
        if (this.canTransition("saving")) {
          this.transition("saving");
        }
        break;

      case "SAVE_COMPLETED":
        if (this.context.state === "saving") {
          this.transition("idle", {
            serverVersion: event.newVersion,
            baseVersion: event.newVersion,
            pendingChanges: false,
            lastSyncedAt: new Date(),
            error: null,
          });
        }
        break;

      case "SAVE_REJECTED":
        // Server rejected due to version conflict (409)
        if (this.context.state === "saving") {
          this.transition("conflict", {
            serverVersion: event.serverVersion,
          });
        }
        break;

      case "RELOAD_REQUESTED":
        // Reload from backend requested
        if (this.canTransition("reloading")) {
          this.transition("reloading", {
            pendingChanges: event.force ? false : this.context.pendingChanges,
          });
        }
        break;

      case "RELOAD_STARTED":
        if (this.canTransition("reloading")) {
          this.transition("reloading");
        }
        break;

      case "RELOAD_COMPLETED":
        if (this.context.state === "reloading") {
          this.transition("idle", {
            serverVersion: event.version,
            baseVersion: event.version,
            localVersion: event.version, // Reset local to match server
            pendingChanges: false,
            lastSyncedAt: new Date(),
            error: null,
          });
        }
        break;

      case "LOCK_ACQUIRED":
        // Backend operation started - pause all local sync
        if (this.canTransition("locked")) {
          this.transition("locked", {
            activeLockId: event.lockId,
            activeOperation: event.operation,
            lockOwnerId: event.userId,
            pendingChanges: false, // Discard pending changes - backend is authoritative
          });
          projectLogger.info("SyncStateMachine", "Lock acquired", {
            lockId: event.lockId,
            operation: event.operation,
            userId: event.userId,
          });
        }
        break;

      case "LOCK_RELEASED":
        // Backend operation completed - reload to get new state
        if (this.context.state === "locked") {
          const updates: Partial<SyncContext> = {
            activeLockId: null,
            activeOperation: null,
            lockOwnerId: null,
          };
          if (event.newVersion !== undefined) {
            updates.serverVersion = event.newVersion;
          }
          // Transition to reloading to fetch new data
          this.transition("reloading", updates);
          projectLogger.info("SyncStateMachine", "Lock released, reloading", {
            lockId: event.lockId,
            newVersion: event.newVersion,
          });
        }
        break;

      case "CONFLICT_DETECTED":
        if (this.canTransition("conflict")) {
          this.transition("conflict", {
            serverVersion: event.serverVersion,
          });
        }
        break;

      case "CONFLICT_RESOLVED":
        if (this.context.state === "conflict") {
          if (event.resolution === "server") {
            // Accept server version - reload
            this.transition("reloading");
          } else {
            // Local wins or merge - go back to idle, ready to save
            this.transition("idle", {
              serverVersion: event.version,
              baseVersion: event.version,
            });
          }
        }
        break;

      case "ERROR":
        if (this.canTransition("error")) {
          this.transition("error", { error: event.error });
        }
        break;

      case "RESET":
        this.context = createInitialContext();
        this.notifyListeners();
        break;
    }

    if (previousState !== this.context.state) {
      projectLogger.debug("SyncStateMachine", "State transition", {
        from: previousState,
        to: this.context.state,
        event: event.type,
        projectId: this.context.projectId,
        localVersion: this.context.localVersion,
        serverVersion: this.context.serverVersion,
      });
    }

    return this.getContext();
  }

  /**
   * Perform a state transition
   */
  private transition(to: SyncState, updates: Partial<SyncContext> = {}): void {
    this.context = {
      ...this.context,
      ...updates,
      state: to,
      stateEnteredAt: Date.now(),
    };
    this.notifyListeners();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getContext());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    const context = this.getContext();
    for (const listener of this.listeners) {
      try {
        listener(context);
      } catch (error) {
        console.error("[SyncStateMachine] Error in listener:", error);
      }
    }
  }

  // Convenience methods

  /**
   * Check if currently syncing (saving or reloading)
   */
  isSyncing(): boolean {
    return ["saving", "reloading"].includes(this.context.state);
  }

  /**
   * Check if saves are blocked (locked, reloading, or conflict)
   */
  isSaveBlocked(): boolean {
    return ["locked", "reloading", "conflict", "error"].includes(
      this.context.state
    );
  }

  /**
   * Check if edits are blocked (locked or reloading)
   */
  isEditBlocked(): boolean {
    return ["locked", "reloading"].includes(this.context.state);
  }

  /**
   * Check if in error state
   */
  hasError(): boolean {
    return this.context.state === "error";
  }

  /**
   * Check if there's a version conflict
   */
  hasConflict(): boolean {
    return this.context.state === "conflict";
  }

  /**
   * Check if currently locked by a backend operation
   */
  isLocked(): boolean {
    return this.context.state === "locked";
  }

  /**
   * Check if there are pending changes
   */
  hasPendingChanges(): boolean {
    return this.context.pendingChanges;
  }

  /**
   * Get the expected version for conditional updates
   */
  getExpectedVersion(): number | null {
    return this.context.baseVersion;
  }

  /**
   * Increment local version (for tracking changes)
   */
  incrementLocalVersion(): void {
    this.context.localVersion++;
    this.context.pendingChanges = true;
    this.notifyListeners();
  }
}

/**
 * Create a new sync state machine instance
 */
export function createSyncStateMachine(): SyncStateMachineImpl {
  return new SyncStateMachineImpl();
}

export type SyncStateMachine = SyncStateMachineImpl;
