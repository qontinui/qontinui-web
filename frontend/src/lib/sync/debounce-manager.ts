/**
 * Debounce Manager
 *
 * Provides unified debounce logic for sync operations.
 * Supports multiple named timers with different intervals.
 */

/**
 * Debounce configuration
 */
export interface DebounceConfig {
  /** Delay in milliseconds before executing */
  delay: number;
  /** Maximum delay - will execute after this time even if still receiving calls */
  maxDelay?: number;
  /** Whether to execute on the leading edge */
  leading?: boolean;
}

/**
 * Timer state for a debounced operation
 */
interface TimerState {
  timeout: NodeJS.Timeout | null;
  maxTimeout: NodeJS.Timeout | null;
  lastCallTime: number;
  pendingFn: (() => void | Promise<void>) | null;
}

/**
 * Manages debounced operations with named timers
 */
class DebounceManagerImpl {
  private timers: Map<string, TimerState> = new Map();
  private configs: Map<string, DebounceConfig> = new Map();

  /**
   * Configure a named debounce timer
   */
  configure(name: string, config: DebounceConfig): void {
    this.configs.set(name, config);
  }

  /**
   * Schedule a debounced operation
   */
  schedule(
    name: string,
    fn: () => void | Promise<void>,
    configOverride?: Partial<DebounceConfig>
  ): void {
    const baseConfig = this.configs.get(name) || { delay: 500 };
    const config = { ...baseConfig, ...configOverride };

    let state = this.timers.get(name);
    if (!state) {
      state = {
        timeout: null,
        maxTimeout: null,
        lastCallTime: 0,
        pendingFn: null,
      };
      this.timers.set(name, state);
    }

    // Clear existing timeout
    if (state.timeout) {
      clearTimeout(state.timeout);
    }

    // Store the pending function
    state.pendingFn = fn;
    state.lastCallTime = Date.now();

    // Execute on leading edge if configured and this is the first call
    if (config.leading && !state.maxTimeout) {
      this.execute(name);
    }

    // Set up the debounce timeout
    state.timeout = setTimeout(() => {
      this.execute(name);
    }, config.delay);

    // Set up max delay timeout if configured and not already set
    if (config.maxDelay && !state.maxTimeout) {
      state.maxTimeout = setTimeout(() => {
        this.execute(name);
      }, config.maxDelay);
    }
  }

  /**
   * Execute the pending operation for a timer
   */
  private async execute(name: string): Promise<void> {
    const state = this.timers.get(name);
    if (!state || !state.pendingFn) return;

    const fn = state.pendingFn;

    // Clear all timeouts
    if (state.timeout) {
      clearTimeout(state.timeout);
      state.timeout = null;
    }
    if (state.maxTimeout) {
      clearTimeout(state.maxTimeout);
      state.maxTimeout = null;
    }

    // Clear pending function before executing (prevents re-execution)
    state.pendingFn = null;

    try {
      await fn();
    } catch (error) {
      console.error(`[DebounceManager] Error executing ${name}:`, error);
    }
  }

  /**
   * Cancel a pending debounced operation
   */
  cancel(name: string): void {
    const state = this.timers.get(name);
    if (!state) return;

    if (state.timeout) {
      clearTimeout(state.timeout);
      state.timeout = null;
    }
    if (state.maxTimeout) {
      clearTimeout(state.maxTimeout);
      state.maxTimeout = null;
    }
    state.pendingFn = null;
  }

  /**
   * Flush (immediately execute) a pending debounced operation
   */
  async flush(name: string): Promise<void> {
    await this.execute(name);
  }

  /**
   * Flush all pending operations
   */
  async flushAll(): Promise<void> {
    const names = Array.from(this.timers.keys());
    await Promise.all(names.map((name) => this.flush(name)));
  }

  /**
   * Cancel all pending operations
   */
  cancelAll(): void {
    for (const name of this.timers.keys()) {
      this.cancel(name);
    }
  }

  /**
   * Check if a timer has a pending operation
   */
  isPending(name: string): boolean {
    const state = this.timers.get(name);
    return state?.pendingFn !== null;
  }

  /**
   * Get time since last call for a timer
   */
  getTimeSinceLastCall(name: string): number {
    const state = this.timers.get(name);
    if (!state || state.lastCallTime === 0) return Infinity;
    return Date.now() - state.lastCallTime;
  }
}

// Export singleton instance
export const debounceManager = new DebounceManagerImpl();

// Pre-configured timer names
export const DEBOUNCE_TIMERS = {
  LOCAL_SAVE: "local-save",
  BACKEND_SAVE: "backend-save",
  WORKFLOWS: "persist-workflows",
  STATES: "persist-states",
  TRANSITIONS: "persist-transitions",
  IMAGES: "persist-images",
  SCREENSHOTS: "persist-screenshots",
} as const;

// Default configurations
debounceManager.configure(DEBOUNCE_TIMERS.LOCAL_SAVE, { delay: 500 });
debounceManager.configure(DEBOUNCE_TIMERS.BACKEND_SAVE, {
  delay: 5000,
  maxDelay: 30000,
});
debounceManager.configure(DEBOUNCE_TIMERS.WORKFLOWS, { delay: 500 });
debounceManager.configure(DEBOUNCE_TIMERS.STATES, { delay: 500 });
debounceManager.configure(DEBOUNCE_TIMERS.TRANSITIONS, { delay: 500 });
debounceManager.configure(DEBOUNCE_TIMERS.IMAGES, { delay: 500 });
debounceManager.configure(DEBOUNCE_TIMERS.SCREENSHOTS, { delay: 500 });
