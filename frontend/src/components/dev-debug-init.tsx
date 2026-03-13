"use client";

/**
 * Dev Debug Initializer - Initializes the dev-debug-logger in development mode
 *
 * This component should be included in the root layout to ensure the logger
 * is initialized and capturing logs as early as possible.
 */

import { useEffect } from "react";

export function DevDebugInit() {
  useEffect(() => {
    // Only in development
    if (process.env.NODE_ENV !== "development") return;

    let cancelled = false;

    // Dynamically import to avoid issues in production builds
    import("@/lib/dev-debug-logger").then(({ devDebugLogger }) => {
      if (cancelled) return;
      if (devDebugLogger.isEnabled()) {
        console.info("[DevDebugInit] Dev debug logger active");

        // Expose helper functions to window for easy access
        (window as unknown as Record<string, unknown>).getDevLogs = () =>
          devDebugLogger.getLogs();
        (window as unknown as Record<string, unknown>).clearDevLogs = () =>
          devDebugLogger.clear();

        console.info(
          "[DevDebugInit] Use window.getDevLogs() / window.clearDevLogs()"
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
