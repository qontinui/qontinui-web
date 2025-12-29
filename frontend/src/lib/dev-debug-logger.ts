/**
 * Dev Debug Logger - Captures all frontend diagnostics for Claude Code
 *
 * Captures:
 * - Console errors, warnings, and logs
 * - Network requests and responses
 * - Unhandled errors and promise rejections
 * - React error boundaries
 *
 * Persists logs to /api/dev-debug/logs endpoint for Claude to read.
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

interface NetworkLogData {
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  duration?: number;
  error?: string;
}

class DevDebugLogger {
  private enabled: boolean;
  private logs: DevLogEntry[] = [];
  private maxLogs: number = 500;
  private flushInterval: number = 5000; // 5 seconds
  private pendingFlush: NodeJS.Timeout | null = null;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  private originalFetch: typeof fetch | null = null;

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
    this.startPeriodicFlush();

    this.originalConsole.info(
      "[DevDebugLogger] Initialized - capturing logs for Claude Code"
    );
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private addLog(entry: Omit<DevLogEntry, "id" | "timestamp">) {
    if (!this.enabled) return;

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

    // Schedule flush
    this.scheduleFlush();
  }

  private interceptConsole() {
    const levels: Array<{ method: keyof typeof console; level: LogLevel }> = [
      { method: "log", level: "info" },
      { method: "info", level: "info" },
      { method: "warn", level: "warn" },
      { method: "error", level: "error" },
      { method: "debug", level: "debug" },
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
              typeof arg === "object"
                ? JSON.stringify(arg, null, 2)
                : String(arg)
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

    window.fetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      const startTime = Date.now();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = init?.method || "GET";

      // Skip logging our own debug endpoint
      if (url.includes("/api/dev-debug")) {
        return boundOriginalFetch(input, init);
      }

      const logData: NetworkLogData = {
        url,
        method,
      };

      // Capture request body (if JSON)
      if (init?.body) {
        try {
          if (typeof init.body === "string") {
            logData.requestBody = JSON.parse(init.body);
          }
        } catch {
          logData.requestBody = "[non-JSON body]";
        }
      }

      try {
        const response = await boundOriginalFetch(input, init);
        const duration = Date.now() - startTime;

        logData.status = response.status;
        logData.statusText = response.statusText;
        logData.duration = duration;

        // Clone response to read body without consuming it
        const clonedResponse = response.clone();

        // Try to capture response body (async, non-blocking)
        clonedResponse
          .text()
          .then((text) => {
            try {
              logData.responseBody = JSON.parse(text);
            } catch {
              logData.responseBody =
                text.length > 500 ? text.substring(0, 500) + "..." : text;
            }

            const level: LogLevel = response.ok ? "info" : "error";
            addLogFn({
              level,
              source: "network",
              message: `${method} ${url} - ${response.status} (${duration}ms)`,
              url,
              method,
              status: response.status,
              duration,
              data: logData as unknown as Record<string, unknown>,
            });
          })
          .catch(() => {
            // Ignore read errors
            addLogFn({
              level: response.ok ? "info" : "error",
              source: "network",
              message: `${method} ${url} - ${response.status} (${duration}ms)`,
              url,
              method,
              status: response.status,
              duration,
              data: logData as unknown as Record<string, unknown>,
            });
          });

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        logData.duration = duration;
        logData.error = error instanceof Error ? error.message : String(error);

        addLogFn({
          level: "error",
          source: "network",
          message: `${method} ${url} - FAILED: ${logData.error} (${duration}ms)`,
          url,
          method,
          duration,
          data: logData as unknown as Record<string, unknown>,
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

  private scheduleFlush() {
    if (this.pendingFlush) return;

    this.pendingFlush = setTimeout(() => {
      this.flush();
      this.pendingFlush = null;
    }, this.flushInterval);
  }

  private startPeriodicFlush() {
    setInterval(() => this.flush(), this.flushInterval * 2);
  }

  private async flush() {
    if (!this.enabled || this.logs.length === 0) return;

    const logsToSend = [...this.logs];
    this.logs = [];

    try {
      // Use original fetch to avoid infinite loop
      const fetchFn = this.originalFetch || fetch;
      await fetchFn("/api/dev-debug/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logs: logsToSend }),
      });
    } catch (error) {
      // Restore logs if flush failed
      this.logs = [...logsToSend, ...this.logs].slice(-this.maxLogs);
      this.originalConsole.error(
        "[DevDebugLogger] Failed to flush logs:",
        error
      );
    }
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

  // Force immediate flush
  async forceFlush(): Promise<void> {
    await this.flush();
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
