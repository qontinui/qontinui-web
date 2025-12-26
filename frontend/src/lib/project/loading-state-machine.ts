/**
 * Loading State Machine
 *
 * Manages project loading state transitions with predictable flow.
 * Prevents race conditions by enforcing valid state transitions.
 *
 * State Flow:
 * IDLE → VALIDATING → SAVING_CURRENT → FETCHING → HYDRATING → LOADED
 *                                                     ↓
 *                                                   ERROR → IDLE
 */

import { projectLogger } from "@/lib/project-logger";

/**
 * Loading states
 */
export type LoadingState =
  | "idle"
  | "validating"
  | "saving-current"
  | "fetching"
  | "hydrating"
  | "loaded"
  | "error";

/**
 * State machine context
 */
export interface LoadingContext {
  /** Current state */
  state: LoadingState;
  /** Project ID being loaded */
  projectId: string | null;
  /** Previous project ID (for save before load) */
  previousProjectId: string | null;
  /** Error message if in error state */
  error: string | null;
  /** Timestamp when current state was entered */
  stateEnteredAt: number;
  /** Number of retries attempted */
  retryCount: number;
}

/**
 * State transition events
 */
export type LoadingEvent =
  | { type: "LOAD"; projectId: string }
  | { type: "VALIDATED"; projectId: string; previousProjectId: string | null }
  | { type: "CURRENT_SAVED" }
  | { type: "SKIP_SAVE" }
  | { type: "FETCHED"; projectData: unknown }
  | { type: "HYDRATED" }
  | { type: "ERROR"; error: string }
  | { type: "RETRY" }
  | { type: "RESET" };

/**
 * State listener callback
 */
export type StateListener = (context: LoadingContext) => void;

/**
 * Valid state transitions
 */
const VALID_TRANSITIONS: Record<LoadingState, LoadingState[]> = {
  idle: ["validating"],
  validating: ["saving-current", "fetching", "error", "idle"],
  "saving-current": ["fetching", "error"],
  fetching: ["hydrating", "error"],
  hydrating: ["loaded", "error"],
  loaded: ["validating", "idle"],
  error: ["idle", "validating"],
};

/**
 * Loading State Machine implementation
 */
class LoadingStateMachine {
  private context: LoadingContext = {
    state: "idle",
    projectId: null,
    previousProjectId: null,
    error: null,
    stateEnteredAt: Date.now(),
    retryCount: 0,
  };

  private listeners: Set<StateListener> = new Set();
  private projectData: unknown = null;

  /**
   * Get current context
   */
  getContext(): LoadingContext {
    return { ...this.context };
  }

  /**
   * Get fetched project data (only valid in hydrating/loaded states)
   */
  getProjectData(): unknown {
    return this.projectData;
  }

  /**
   * Check if a transition is valid
   */
  canTransition(to: LoadingState): boolean {
    return VALID_TRANSITIONS[this.context.state]?.includes(to) ?? false;
  }

  /**
   * Send an event to the state machine
   */
  send(event: LoadingEvent): LoadingContext {
    const previousState = this.context.state;

    switch (event.type) {
      case "LOAD":
        if (this.canTransition("validating")) {
          this.transition("validating", {
            projectId: event.projectId,
            error: null,
          });
        } else {
          projectLogger.warn("LoadingStateMachine", "Invalid transition", {
            from: previousState,
            to: "validating",
            event: event.type,
          });
        }
        break;

      case "VALIDATED":
        if (event.previousProjectId && event.previousProjectId !== event.projectId) {
          if (this.canTransition("saving-current")) {
            this.transition("saving-current", {
              previousProjectId: event.previousProjectId,
            });
          }
        } else if (this.canTransition("fetching")) {
          this.transition("fetching");
        }
        break;

      case "CURRENT_SAVED":
      case "SKIP_SAVE":
        if (this.canTransition("fetching")) {
          this.transition("fetching");
        }
        break;

      case "FETCHED":
        if (this.canTransition("hydrating")) {
          this.projectData = event.projectData;
          this.transition("hydrating");
        }
        break;

      case "HYDRATED":
        if (this.canTransition("loaded")) {
          this.transition("loaded", { retryCount: 0 });
        }
        break;

      case "ERROR":
        if (this.canTransition("error")) {
          this.transition("error", { error: event.error });
        }
        break;

      case "RETRY":
        if (this.context.state === "error" && this.canTransition("validating")) {
          this.transition("validating", {
            retryCount: this.context.retryCount + 1,
            error: null,
          });
        }
        break;

      case "RESET":
        this.transition("idle", {
          projectId: null,
          previousProjectId: null,
          error: null,
          retryCount: 0,
        });
        this.projectData = null;
        break;
    }

    if (previousState !== this.context.state) {
      projectLogger.debug("LoadingStateMachine", "State transition", {
        from: previousState,
        to: this.context.state,
        event: event.type,
        projectId: this.context.projectId,
      });
    }

    return this.getContext();
  }

  /**
   * Perform a state transition
   */
  private transition(
    to: LoadingState,
    updates: Partial<LoadingContext> = {}
  ): void {
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
  subscribe(listener: StateListener): () => void {
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
        console.error("[LoadingStateMachine] Error in listener:", error);
      }
    }
  }

  /**
   * Check if currently loading
   */
  isLoading(): boolean {
    return ["validating", "saving-current", "fetching", "hydrating"].includes(
      this.context.state
    );
  }

  /**
   * Check if in error state
   */
  hasError(): boolean {
    return this.context.state === "error";
  }

  /**
   * Check if loaded successfully
   */
  isLoaded(): boolean {
    return this.context.state === "loaded";
  }
}

/**
 * Create a new loading state machine instance
 */
export function createLoadingStateMachine(): LoadingStateMachine {
  return new LoadingStateMachine();
}

export type { LoadingStateMachine };
