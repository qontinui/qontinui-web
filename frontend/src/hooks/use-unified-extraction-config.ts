/**
 * Unified Extraction Config Hook
 *
 * Manages unified extraction configuration that supports multiple extraction methods:
 * - Web Extraction (DOM-based)
 * - UI-TARS Web (Vision-based for websites)
 * - UI-TARS Desktop (Vision-based for native apps)
 * - Image Extraction (Template matching)
 *
 * Configuration is persisted in localStorage until logout.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_UITARS_CONFIG,
  DEFAULT_UNIFIED_CONFIG,
  DEFAULT_VISION_CONFIG,
  DEFAULT_WEB_CONFIG,
  type ExtractionMethod,
  type ImageExtractionConfig,
  type UITarsExtractionConfig,
  type UnifiedExtractionConfig,
  type VisionExtractionConfig,
  type WebExtractionConfig,
} from "@/types/extraction-unified";

const STORAGE_KEY = "qontinui_unified_extraction_config";
const LEGACY_STORAGE_KEY = "qontinui_extraction_config";

/**
 * Clear the persisted unified extraction config from localStorage.
 * Called on logout to ensure config doesn't persist across sessions.
 */
export function clearUnifiedExtractionConfig(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Migrate legacy extraction config to unified format.
 */
function migrateLegacyConfig(): UnifiedExtractionConfig | null {
  if (typeof window === "undefined") return null;

  try {
    const legacyStored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyStored) return null;

    const legacy = JSON.parse(legacyStored) as {
      urls?: string[];
      selectedMonitors?: number[];
      captureHover?: boolean;
      captureFocus?: boolean;
      maxDepth?: number;
      maxPages?: number;
    };

    // Convert legacy format to unified format
    const unified: UnifiedExtractionConfig = {
      ...DEFAULT_UNIFIED_CONFIG,
      method: "web",
      selectedMonitors: legacy.selectedMonitors ?? [0],
      webConfig: {
        urls: legacy.urls ?? [""],
        captureHover: legacy.captureHover ?? true,
        captureFocus: legacy.captureFocus ?? true,
        maxDepth: legacy.maxDepth ?? 5,
        maxPages: legacy.maxPages ?? 100,
      },
    };

    return unified;
  } catch (error) {
    console.error("Failed to migrate legacy extraction config:", error);
    return null;
  }
}

/**
 * Hook for managing unified extraction configuration.
 * Config is stored in localStorage and persists until logout.
 */
export function useUnifiedExtractionConfig() {
  const [config, setConfigState] = useState<UnifiedExtractionConfig>(
    DEFAULT_UNIFIED_CONFIG
  );
  const [isLoaded, setIsLoaded] = useState(false);

  // Load config from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      // First try to load unified config
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<UnifiedExtractionConfig>;
        setConfigState({
          ...DEFAULT_UNIFIED_CONFIG,
          ...parsed,
          webConfig: { ...DEFAULT_WEB_CONFIG, ...parsed.webConfig },
          uitarsConfig: { ...DEFAULT_UITARS_CONFIG, ...parsed.uitarsConfig },
          imageConfig: { ...DEFAULT_IMAGE_CONFIG, ...parsed.imageConfig },
          visionConfig: { ...DEFAULT_VISION_CONFIG, ...parsed.visionConfig },
        });
      } else {
        // Try to migrate legacy config
        const migrated = migrateLegacyConfig();
        if (migrated) {
          setConfigState(migrated);
          // Save migrated config
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        }
      }
    } catch (error) {
      console.error("Failed to load unified extraction config:", error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save config to localStorage whenever it changes
  const setConfig = useCallback(
    (
      updater:
        | UnifiedExtractionConfig
        | ((prev: UnifiedExtractionConfig) => UnifiedExtractionConfig)
    ) => {
      setConfigState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;

        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch (error) {
            console.error("Failed to save unified extraction config:", error);
          }
        }

        return next;
      });
    },
    []
  );

  // Convenience setters
  const setMethod = useCallback(
    (method: ExtractionMethod) => {
      setConfig((prev) => ({ ...prev, method }));
    },
    [setConfig]
  );

  const setSelectedMonitors = useCallback(
    (selectedMonitors: number[]) => {
      setConfig((prev) => ({ ...prev, selectedMonitors }));
    },
    [setConfig]
  );

  const setWebConfig = useCallback(
    (
      webConfig:
        | WebExtractionConfig
        | ((prev: WebExtractionConfig) => WebExtractionConfig)
    ) => {
      setConfig((prev) => ({
        ...prev,
        webConfig:
          typeof webConfig === "function"
            ? webConfig(prev.webConfig)
            : webConfig,
      }));
    },
    [setConfig]
  );

  const setUitarsConfig = useCallback(
    (
      uitarsConfig:
        | UITarsExtractionConfig
        | ((prev: UITarsExtractionConfig) => UITarsExtractionConfig)
    ) => {
      setConfig((prev) => ({
        ...prev,
        uitarsConfig:
          typeof uitarsConfig === "function"
            ? uitarsConfig(prev.uitarsConfig)
            : uitarsConfig,
      }));
    },
    [setConfig]
  );

  const setImageConfig = useCallback(
    (
      imageConfig:
        | ImageExtractionConfig
        | ((prev: ImageExtractionConfig) => ImageExtractionConfig)
    ) => {
      setConfig((prev) => ({
        ...prev,
        imageConfig:
          typeof imageConfig === "function"
            ? imageConfig(prev.imageConfig)
            : imageConfig,
      }));
    },
    [setConfig]
  );

  const setVisionConfig = useCallback(
    (
      visionConfig:
        | VisionExtractionConfig
        | ((prev: VisionExtractionConfig) => VisionExtractionConfig)
    ) => {
      setConfig((prev) => ({
        ...prev,
        visionConfig:
          typeof visionConfig === "function"
            ? visionConfig(prev.visionConfig)
            : visionConfig,
      }));
    },
    [setConfig]
  );

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_UNIFIED_CONFIG);
  }, [setConfig]);

  // Web config convenience setters
  const setUrls = useCallback(
    (urls: string[]) => {
      setWebConfig((prev) => ({ ...prev, urls }));
    },
    [setWebConfig]
  );

  const setCaptureHover = useCallback(
    (captureHover: boolean) => {
      setWebConfig((prev) => ({ ...prev, captureHover }));
    },
    [setWebConfig]
  );

  const setCaptureFocus = useCallback(
    (captureFocus: boolean) => {
      setWebConfig((prev) => ({ ...prev, captureFocus }));
    },
    [setWebConfig]
  );

  const setMaxDepth = useCallback(
    (maxDepth: number) => {
      setWebConfig((prev) => ({ ...prev, maxDepth }));
    },
    [setWebConfig]
  );

  const setMaxPages = useCallback(
    (maxPages: number) => {
      setWebConfig((prev) => ({ ...prev, maxPages }));
    },
    [setWebConfig]
  );

  return {
    config,
    isLoaded,
    setConfig,
    setMethod,
    setSelectedMonitors,
    setWebConfig,
    setUitarsConfig,
    setImageConfig,
    setVisionConfig,
    resetConfig,
    // Web config convenience setters (for backward compatibility)
    setUrls,
    setCaptureHover,
    setCaptureFocus,
    setMaxDepth,
    setMaxPages,
  };
}
