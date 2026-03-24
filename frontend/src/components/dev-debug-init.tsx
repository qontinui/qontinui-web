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
    if (process.env.NODE_ENV !== "development") return;

    let cancelled = false;

    import("@/lib/dev-debug-logger")
      .then(({ devDebugLogger }) => {
        if (cancelled) return;
        if (devDebugLogger.isEnabled()) {
          (window as unknown as Record<string, unknown>).getDevLogs = () =>
            devDebugLogger.getLogs();
          (window as unknown as Record<string, unknown>).clearDevLogs = () =>
            devDebugLogger.clear();
        }
      })
      .catch(() => {
        // Silently ignore — dev-only module, nothing to recover
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
