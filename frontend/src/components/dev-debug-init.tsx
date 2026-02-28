"use client";

/**
 * Dev Debug Initializer - Initializes the dev-debug-logger in development mode
 *
 * This component should be included in the root layout to ensure the logger
 * is initialized and capturing logs as early as possible.
 */

import { useEffect } from "react";

/** Fetch dev debug logs - exposed as window.getDevLogs() in development */
async function fetchDevLogs() {
  const response = await fetch("/api/dev-debug/logs?limit=200");
  const data = await response.json();
  console.table(data.stats);
  return data;
}

/** Clear dev debug logs - exposed as window.clearDevLogs() in development */
async function clearDevLogs() {
  await fetch("/api/dev-debug/logs", { method: "DELETE" });
  console.info("[DevDebugInit] Logs cleared");
}

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
        (window as unknown as Record<string, unknown>).getDevLogs =
          fetchDevLogs;
        (window as unknown as Record<string, unknown>).clearDevLogs =
          clearDevLogs;

        // Log helpful message
        console.info("[DevDebugInit] Use window.getDevLogs() to retrieve logs");
        console.info("[DevDebugInit] Use window.clearDevLogs() to clear logs");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
