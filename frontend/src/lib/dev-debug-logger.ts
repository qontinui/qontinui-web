/* eslint-disable no-console */
/**
 * Dev Debug Logger - Captures all frontend diagnostics for Claude Code
 *
 * Captures:
 * - Console errors, warnings, and logs
 * - Network requests and responses
 * - Unhandled errors and promise rejections
 * - React error boundaries
 *
 * Logs are kept in-memory (capped at 500) and available via window.devDebugLogger.getLogs().
 * Only active in development mode.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "console" | "network" | "error" | "react" | "custom";

export interface DevLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  data?: Record<string, unknown>;
  stack?: string;
  url?: string;
  method?: string;
  status?: number;
  duration?: number;
}

class DevDebugLogger {
  private enabled: boolean;
  private logs: DevLogEntry[] = [];
  private maxLogs: number = 500;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  private originalFetch: typeof fetch | null = null;
  // Deduplication for repeated errors
  private recentErrors: Map<string, { count: number; lastTime: number }> =
    new Map();
  private errorDedupeWindow: number = 10000; // 10 seconds
  // Endpoints to skip logging entirely (framework internals)
  private skipLogPatterns: string[] = [
    "/_next/",
    "__nextjs",
    "webpack",
    "/favicon",
    "hot-update",
  ];

  constructor() {
    // Only enable in development
    this.enabled = process.env.NODE_ENV === "development";

    // Store original console methods
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    if (this.enabled && typeof window !== "undefined") {
      this.init();
    }
  }

  private init() {
    this.interceptConsole();
    this.interceptFetch();
    this.interceptErrors();

    this.originalConsole.info(
      "[DevDebugLogger] Initialized - capturing logs for Claude Code"
    );
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private addLog(entry: Omit<DevLogEntry, "id" | "timestamp">) {
    if (!this.enabled) return;

    // Deduplicate repeated error messages within a time window
    if (entry.level === "error") {
      const errorKey = entry.message;
      const now = Date.now();
      const existing = this.recentErrors.get(errorKey);

      if (existing && now - existing.lastTime < this.errorDedupeWindow) {
        // Update count but don't add new log entry
        existing.count++;
        existing.lastTime = now;

        // Only log every 10th occurrence to reduce noise
        if (existing.count % 10 !== 0) {
          return;
        }
        // Add note about repetition
        entry = {
          ...entry,
          message: `${entry.message} (repeated ${existing.count}x)`,
        };
      } else {
        // New error or outside dedup window
        this.recentErrors.set(errorKey, { count: 1, lastTime: now });

        // Clean up old entries periodically
        if (this.recentErrors.size > 100) {
          for (const [key, value] of this.recentErrors.entries()) {
            if (now - value.lastTime > this.errorDedupeWindow * 2) {
              this.recentErrors.delete(key);
            }
          }
        }
      }
    }

    const fullEntry: DevLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.push(fullEntry);

    // Trim if over max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  private interceptConsole() {
    // Only intercept warn/error — log/info/debug are too noisy and add overhead
    const levels: Array<{ method: keyof typeof console; level: LogLevel }> = [
      { method: "warn", level: "warn" },
      { method: "error", level: "error" },
    ];

    for (const { method, level } of levels) {
      const original =
        this.originalConsole[method as keyof typeof this.originalConsole];
      (console as unknown as Record<string, (...args: unknown[]) => void>)[
        method
      ] = (...args: unknown[]) => {
        // Call original
        original(...args);

        // Skip our own logs to prevent infinite loop
        if (args[0]?.toString?.().includes("[DevDebugLogger]")) return;

        // Capture
        this.addLog({
          level,
          source: "console",
          message: args
            .map((arg) =>
              typeof arg === "object" ? JSON.stringify(arg) : String(arg)
            )
            .join(" "),
          data: args.length > 1 ? { args: args.slice(1) } : undefined,
        });
      };
    }
  }

  private interceptFetch() {
    if (typeof window === "undefined") return;

    this.originalFetch = window.fetch.bind(window);
    const boundOriginalFetch = this.originalFetch;
    const addLogFn = this.addLog.bind(this);
    const skipLogPatterns = this.skipLogPatterns;

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      // Skip framework-internal and debug requests entirely (no interception overhead)
      if (
        url.includes("/api/dev-debug") ||
        skipLogPatterns.some((p) => url.includes(p))
      ) {
        return boundOriginalFetch(input, init);
      }

      const startTime = Date.now();
      const method = init?.method || "GET";

      try {
        const response = await boundOriginalFetch(input, init);
        const duration = Date.now() - startTime;

        // Log URL + status + duration only — never clone response bodies.
        // Response body cloning (clone + text + JSON.parse) creates 3 copies of
        // every response and was the primary cause of memory leaks with polling hooks.
        addLogFn({
          level: response.ok ? "info" : "error",
          source: "network",
          message: `${method} ${url} - ${response.status} (${duration}ms)`,
          url,
          method,
          status: response.status,
          duration,
        });

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;

        addLogFn({
          level: "error",
          source: "network",
          message: `${method} ${url} - FAILED: ${error instanceof Error ? error.message : String(error)} (${duration}ms)`,
          url,
          method,
          duration,
          stack: error instanceof Error ? error.stack : undefined,
        });

        throw error;
      }
    };
  }

  private interceptErrors() {
    if (typeof window === "undefined") return;

    // Global error handler
    window.onerror = (message, source, lineno, colno, error) => {
      this.addLog({
        level: "error",
        source: "error",
        message: String(message),
        data: {
          source,
          lineno,
          colno,
        },
        stack: error?.stack,
      });
      return false; // Don't prevent default handling
    };

    // Unhandled promise rejection handler
    window.onunhandledrejection = (event) => {
      const error = event.reason;
      this.addLog({
        level: "error",
        source: "error",
        message: `Unhandled Promise Rejection: ${error?.message || String(error)}`,
        stack: error?.stack,
        data: {
          reason: error,
        },
      });
    };
  }

  /**
   * Clean up all intervals and restore original functions.
   * Call this when the logger is no longer needed.
   */
  destroy() {
    // Restore original console methods
    if (this.enabled) {
      console.log = this.originalConsole.log;
      console.info = this.originalConsole.info;
      console.warn = this.originalConsole.warn;
      console.error = this.originalConsole.error;
      console.debug = this.originalConsole.debug;
    }
    // Restore original fetch
    if (this.originalFetch && typeof window !== "undefined") {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }
    this.enabled = false;
    this.logs = [];
    this.recentErrors.clear();
  }

  // Public API for manual logging

  log(message: string, data?: Record<string, unknown>) {
    this.addLog({ level: "info", source: "custom", message, data });
  }

  error(message: string, error?: Error, data?: Record<string, unknown>) {
    this.addLog({
      level: "error",
      source: "custom",
      message,
      stack: error?.stack,
      data: { ...data, errorMessage: error?.message },
    });
  }

  // Log React error boundary captures
  logReactError(error: Error, errorInfo: { componentStack?: string }) {
    this.addLog({
      level: "error",
      source: "react",
      message: `React Error: ${error.message}`,
      stack: error.stack,
      data: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  // Get current in-memory logs (for debugging)
  getLogs(): DevLogEntry[] {
    return [...this.logs];
  }

  // Clear all in-memory logs
  clear() {
    this.logs = [];
    this.recentErrors.clear();
  }

  // Check if enabled
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const devDebugLogger = new DevDebugLogger();

// Expose to window for debugging
if (typeof window !== "undefined") {
  (
    window as unknown as Window & { devDebugLogger: DevDebugLogger }
  ).devDebugLogger = devDebugLogger;
}
