/**
 * use-automated-discovery.ts
 *
 * Thin React hook wrapping page-crawler.ts for automated page discovery.
 * Provides React state management (progress, error, cancellation) on top
 * of the pure async crawl functions.
 */

import { useState, useCallback, useRef } from "react";
import type { PageEntry } from "@/lib/page-discovery-types";
import {
  mergeDiscoveredPages,
  noSpecPageEntry,
} from "@/lib/page-discovery-types";
import type { CrawlProgress } from "@/lib/ui-bridge/page-crawler";
import { discoverAndCrawlAllPages } from "@/lib/ui-bridge/page-crawler";
import {
  parseDiscoveredSpecs,
  unwrapSpecResponse,
} from "@/lib/ui-bridge/spec-parser";
import { runnerApi } from "@/lib/runner/runner-api-object";

// =============================================================================
// Types
// =============================================================================

export interface UseAutomatedDiscoveryReturn {
  /** Auto-discover links from the current page, crawl each, return all PageEntry[]. */
  discoverAllPages: () => Promise<PageEntry[]>;
  /** Discover specs on just the current page. Returns a single PageEntry or null on failure. */
  discoverCurrentPageSpecs: () => Promise<PageEntry | null>;
  /** Cancel an in-progress crawl. */
  cancel: () => void;
  /** Whether a crawl is currently running. */
  isRunning: boolean;
  /** Current crawl progress (null when idle). */
  progress: CrawlProgress | null;
  /** Error message from the last operation (null on success). */
  error: string | null;
}

export interface UseAutomatedDiscoveryOptions {
  /** Origin URL of the connected app (e.g. "http://localhost:3001"). */
  appOrigin?: string;
  /** Target a specific browser tab for navigation. */
  targetTabId?: string;
}

// =============================================================================
// Hook
// =============================================================================

export function useAutomatedDiscovery(
  options?: UseAutomatedDiscoveryOptions
): UseAutomatedDiscoveryReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const discoverAllPages = useCallback(async (): Promise<PageEntry[]> => {
    setIsRunning(true);
    setError(null);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const pages = await discoverAndCrawlAllPages({
        appOrigin: options?.appOrigin,
        targetTabId: options?.targetTabId,
        signal: controller.signal,
        onProgress: setProgress,
      });

      if (controller.signal.aborted) {
        setError("Discovery cancelled");
        return [];
      }

      return pages;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Auto-discovery failed";
      setError(msg);
      return [];
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [options?.appOrigin, options?.targetTabId]);

  const discoverCurrentPageSpecs =
    useCallback(async (): Promise<PageEntry | null> => {
      setIsRunning(true);
      setError(null);

      try {
        const raw = await runnerApi.uiBridgeDiscover({ action: "getSpecs" });
        const rawSpecs = unwrapSpecResponse(raw);
        const specs = parseDiscoveredSpecs(rawSpecs);

        if (specs.length > 0) {
          const merged = mergeDiscoveredPages([], specs);
          return merged[0] ?? null;
        }

        // No specs — try to get current URL for a no-spec entry
        try {
          const snapshot = await runnerApi.uiBridgeSnapshot();
          const url = (snapshot as Record<string, unknown>)?.url;
          if (typeof url === "string") {
            const pathname = new URL(url).pathname;
            return noSpecPageEntry(pathname);
          }
        } catch {
          // Ignore snapshot failure
        }

        return null;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Spec discovery failed";
        setError(msg);
        return null;
      } finally {
        setIsRunning(false);
      }
    }, []);

  return {
    discoverAllPages,
    discoverCurrentPageSpecs,
    cancel,
    isRunning,
    progress,
    error,
  };
}
