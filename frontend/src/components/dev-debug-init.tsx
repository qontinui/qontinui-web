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

    // Dynamically import to avoid issues in production builds
    import("@/lib/dev-debug-logger").then(({ devDebugLogger }) => {
      if (devDebugLogger.isEnabled()) {
        console.info("[DevDebugInit] Dev debug logger active");

        // Expose helper function to window for easy access
        (window as unknown).getDevLogs = async () => {
          const response = await fetch("/api/dev-debug/logs?limit=200");
          const data = await response.json();
          console.table(data.stats);
          return data;
        };
        (window as unknown).clearDevLogs = async () => {
          await fetch("/api/dev-debug/logs", { method: "DELETE" });
          console.info("[DevDebugInit] Logs cleared");
        };

        // Log helpful message
        console.info("[DevDebugInit] Use window.getDevLogs() to retrieve logs");
        console.info("[DevDebugInit] Use window.clearDevLogs() to clear logs");
      }
    });
  }, []);

  return null;
}
