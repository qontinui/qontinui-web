"use client";

/**
 * Render Log Processing Hook
 *
 * Converts exploration results into render log formats suitable
 * for state discovery via co-occurrence analysis.
 */

import { useCallback } from "react";

import type { ExplorationResults } from "./types";

export interface UseRenderLogProcessingReturn {
  /** Convert render logs to format expected by state discovery */
  getRenderLogsForDiscovery: () => Array<{
    id: string;
    type: string;
    page_url: string;
    snapshot: { root: unknown };
    timestamp: number;
    trigger: string;
  }>;
}

/**
 * Hook for processing render logs from exploration results.
 *
 * Provides conversion utilities to transform exploration render logs
 * into the format expected by downstream state discovery pipelines.
 */
export function useRenderLogProcessing(
  results: ExplorationResults
): UseRenderLogProcessingReturn {
  /**
   * Convert render logs to format expected by state discovery
   */
  const getRenderLogsForDiscovery = useCallback(() => {
    return results.renderLogs.map((log) => ({
      id: log.id,
      type: "dom_snapshot",
      page_url: log.url,
      snapshot: log.snapshot,
      timestamp: log.timestamp,
      trigger: log.trigger,
    }));
  }, [results.renderLogs]);

  return {
    getRenderLogsForDiscovery,
  };
}
