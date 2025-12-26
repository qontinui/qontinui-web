/**
 * Persistent Extraction Config Hook
 *
 * Persists web extraction configuration in localStorage until logout.
 * This allows users to navigate away and return with their config intact.
 */

"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "qontinui_extraction_config";

export interface ExtractionConfig {
  urls: string[];
  selectedMonitors: number[];
  captureHover: boolean;
  captureFocus: boolean;
  maxDepth: number;
  maxPages: number;
}

const DEFAULT_CONFIG: ExtractionConfig = {
  urls: [""],
  selectedMonitors: [0],
  captureHover: true,
  captureFocus: true,
  maxDepth: 5,
  maxPages: 100,
};

/**
 * Clear the persisted extraction config from localStorage.
 * Called on logout to ensure config doesn't persist across sessions.
 */
export function clearExtractionConfig(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Hook for managing persistent extraction configuration.
 * Config is stored in localStorage and persists until logout.
 */
export function useExtractionConfig() {
  const [config, setConfigState] = useState<ExtractionConfig>(DEFAULT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load config from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ExtractionConfig>;
        // Merge with defaults to handle any missing fields
        setConfigState({
          ...DEFAULT_CONFIG,
          ...parsed,
        });
      }
    } catch (error) {
      console.error("Failed to load extraction config:", error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save config to localStorage whenever it changes
  const setConfig = useCallback(
    (
      updater: ExtractionConfig | ((prev: ExtractionConfig) => ExtractionConfig)
    ) => {
      setConfigState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;

        // Save to localStorage
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch (error) {
            console.error("Failed to save extraction config:", error);
          }
        }

        return next;
      });
    },
    []
  );

  // Individual setters for convenience
  const setUrls = useCallback(
    (urls: string[]) => {
      setConfig((prev) => ({ ...prev, urls }));
    },
    [setConfig]
  );

  const setSelectedMonitors = useCallback(
    (selectedMonitors: number[]) => {
      setConfig((prev) => ({ ...prev, selectedMonitors }));
    },
    [setConfig]
  );

  const setCaptureHover = useCallback(
    (captureHover: boolean) => {
      setConfig((prev) => ({ ...prev, captureHover }));
    },
    [setConfig]
  );

  const setCaptureFocus = useCallback(
    (captureFocus: boolean) => {
      setConfig((prev) => ({ ...prev, captureFocus }));
    },
    [setConfig]
  );

  const setMaxDepth = useCallback(
    (maxDepth: number) => {
      setConfig((prev) => ({ ...prev, maxDepth }));
    },
    [setConfig]
  );

  const setMaxPages = useCallback(
    (maxPages: number) => {
      setConfig((prev) => ({ ...prev, maxPages }));
    },
    [setConfig]
  );

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
  }, [setConfig]);

  return {
    config,
    isLoaded,
    setConfig,
    setUrls,
    setSelectedMonitors,
    setCaptureHover,
    setCaptureFocus,
    setMaxDepth,
    setMaxPages,
    resetConfig,
  };
}
