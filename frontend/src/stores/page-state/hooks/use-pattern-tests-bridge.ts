/**
 * Pattern Tests Bridge Hook
 *
 * Provides a bridge between the old useState-based approach and the new
 * Zustand store, making migration easier. This hook provides the same
 * interface as the original component's state.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { usePatternTestsStore } from "../pattern-tests-store";
import type { Region } from "@/types/pattern-optimization";
import type { MatchResult as StoreMatchResult } from "../types";

// Re-export types for convenience
export type TemplateSource = "upload" | "state" | "asset";

export interface Screenshot {
  id: string;
  name: string;
  url: string;
}

// Component MatchResult format (backwards compatible with old component)
export interface MatchResult {
  region: { x: number; y: number; width: number; height: number };
  score: number;
  index?: number;
}

/**
 * Bridge hook for Pattern Tests page.
 * Provides the same interface as the original useState-based approach
 * but backed by persistent Zustand store.
 */
export function usePatternTestsBridge() {
  const { user } = useAuth();
  const { projectName } = useAutomation();
  const store = usePatternTestsStore();
  const hasHydrated = useRef(false);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate on mount
  useEffect(() => {
    if (user?.id && projectName && !hasHydrated.current) {
      hasHydrated.current = true;
      store.hydrate(projectName, user.id);
    }
  }, [user?.id, projectName, store]);

  // Persist on unmount
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      store.persist().finally(() => {
        store.cleanup();
      });
    };
  }, [store]);

  // Debounced persist
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      store.persist();
    }, 500);
  }, [store]);

  // Listen for beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      store.persist();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [store]);

  // Convert store screenshot to component Screenshot format
  const selectedScreenshot: Screenshot | null = store.selectedScreenshot
    ? {
        id: store.selectedScreenshot.id,
        name: store.selectedScreenshot.name,
        url: store.selectedScreenshot.url || "",
      }
    : null;

  // Template image URL for display
  const templateImage = store.templateImage?.url || null;

  // Convert matches from store format to component format
  const matches: MatchResult[] = store.matches.map((m, index) => ({
    region: {
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
    },
    score: m.score,
    index: index + 1,
  }));

  // State setters that mirror the original component's setState functions
  const setSelectedScreenshot = useCallback(
    async (screenshot: Screenshot | null) => {
      if (screenshot) {
        // Create a File-like object from URL
        const response = await fetch(screenshot.url);
        const blob = await response.blob();
        const file = new File([blob], screenshot.name, { type: blob.type });

        await store.setSelectedScreenshot({
          id: screenshot.id,
          name: screenshot.name,
          file,
        });
      } else {
        await store.setSelectedScreenshot(null);
      }
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const handleUploadScreenshot = useCallback(
    async (file: File) => {
      const id = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await store.setSelectedScreenshot({
        id,
        name: file.name,
        file,
      });
      store.clearResults();
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const handleSelectProjectScreenshot = useCallback(
    async (screenshot: Screenshot) => {
      const response = await fetch(screenshot.url);
      const blob = await response.blob();
      const file = new File([blob], screenshot.name, { type: blob.type });

      await store.setSelectedScreenshot({
        id: screenshot.id,
        name: screenshot.name,
        file,
      });
      store.clearResults();
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const handleClearScreenshot = useCallback(async () => {
    await store.setSelectedScreenshot(null);
    store.clearResults();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const setScreenshotDimensions = useCallback(
    (dimensions: { width: number; height: number } | null) => {
      store.setScreenshotDimensions(dimensions);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setTemplateImage = useCallback(
    async (dataUrl: string | null) => {
      if (dataUrl) {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], "template.png", { type: blob.type });
        await store.setTemplateImage(file);
      } else {
        await store.setTemplateImage(null);
      }
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setTemplateSource = useCallback(
    (source: TemplateSource) => {
      store.setTemplateSource(source);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedStateImage = useCallback(
    (id: string) => {
      store.setSelectedStateImageId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedAssetImage = useCallback(
    (id: string) => {
      store.setSelectedAssetImageId(id);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSimilarity = useCallback(
    (similarity: number) => {
      store.setSimilarity(similarity);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setFindAll = useCallback(
    (findAll: boolean) => {
      store.setFindAll(findAll);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSearchRegion = useCallback(
    (region: Region | null) => {
      store.setSearchRegion(region);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setMatches = useCallback(
    (newMatches: MatchResult[]) => {
      // Convert from component format to store format
      const storeMatches: StoreMatchResult[] = newMatches.map((m, index) => ({
        id: `match-${index}`,
        x: m.region.x,
        y: m.region.y,
        width: m.region.width,
        height: m.region.height,
        score: m.score,
      }));
      store.setMatches(storeMatches);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSearchTime = useCallback(
    (time: number) => {
      store.setSearchTime(time);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setSelectedMatch = useCallback(
    (match: MatchResult | null) => {
      // Find the corresponding store match by comparing region
      if (match) {
        const storeMatch = store.matches.find(
          (m) =>
            m.x === match.region.x &&
            m.y === match.region.y &&
            m.width === match.region.width &&
            m.height === match.region.height &&
            m.score === match.score
        );
        store.setSelectedMatchId(storeMatch?.id || null);
      } else {
        store.setSelectedMatchId(null);
      }
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const clearResults = useCallback(() => {
    store.clearResults();
    debouncedPersist();
  }, [store, debouncedPersist]);

  const setShowMatches = useCallback(
    (show: boolean) => {
      store.setShowMatches(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setShowScores = useCallback(
    (show: boolean) => {
      store.setShowScores(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setShowHeatmap = useCallback(
    (show: boolean) => {
      store.setShowHeatmap(show);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setHighlightBest = useCallback(
    (highlight: boolean) => {
      store.setHighlightBest(highlight);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setZoom = useCallback(
    (zoom: number) => {
      store.setZoom(zoom);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const setPanOffset = useCallback(
    (offset: { x: number; y: number }) => {
      store.setPanOffset(offset);
      debouncedPersist();
    },
    [store, debouncedPersist]
  );

  const resetView = useCallback(() => {
    store.resetView();
    debouncedPersist();
  }, [store, debouncedPersist]);

  // Find selected match from ID
  const selectedMatch = (() => {
    if (!store.selectedMatchId) return null;
    const storeMatch = store.matches.find((m) => m.id === store.selectedMatchId);
    if (!storeMatch) return null;
    return {
      region: {
        x: storeMatch.x,
        y: storeMatch.y,
        width: storeMatch.width,
        height: storeMatch.height,
      },
      score: storeMatch.score,
    };
  })();

  return {
    // Hydration status
    isHydrated: store.isHydrated,
    isHydrating: store.isHydrating,

    // State values (read-only)
    selectedScreenshot,
    screenshotDimensions: store.screenshotDimensions,
    templateImage,
    templateSource: store.templateSource,
    selectedStateImage: store.selectedStateImageId,
    selectedAssetImage: store.selectedAssetImageId,
    similarity: store.similarity,
    findAll: store.findAll,
    searchRegion: store.searchRegion,
    matches,
    searchTime: store.searchTime,
    selectedMatch,
    showMatches: store.showMatches,
    showScores: store.showScores,
    showHeatmap: store.showHeatmap,
    highlightBest: store.highlightBest,
    zoom: store.zoom,
    panOffset: store.panOffset,

    // Actions (same interface as useState setters)
    setSelectedScreenshot,
    handleUploadScreenshot,
    handleSelectProjectScreenshot,
    handleClearScreenshot,
    setScreenshotDimensions,
    setTemplateImage,
    setTemplateSource,
    setSelectedStateImage,
    setSelectedAssetImage,
    setSimilarity,
    setFindAll,
    setSearchRegion,
    setMatches,
    setSearchTime,
    setSelectedMatch,
    clearResults,
    setShowMatches,
    setShowScores,
    setShowHeatmap,
    setHighlightBest,
    setZoom,
    setPanOffset,
    resetView,
  };
}
