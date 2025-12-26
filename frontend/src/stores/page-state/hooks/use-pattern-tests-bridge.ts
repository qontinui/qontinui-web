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

  // Keep stable ref to store to avoid infinite loops
  const storeRef = useRef(store);
  storeRef.current = store;

  const hasHydrated = useRef(false);
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Hydrate on mount
  useEffect(() => {
    if (user?.id && projectName && !hasHydrated.current) {
      hasHydrated.current = true;
      storeRef.current.hydrate(projectName, user.id);
    }

  }, [user?.id, projectName]);

  // Persist on unmount
  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      storeRef.current.persist().finally(() => {
        storeRef.current.cleanup();
      });
    };
  }, []);

  // Debounced persist
  const debouncedPersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(() => {
      storeRef.current.persist();
    }, 500);
  }, []);

  // Listen for beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      storeRef.current.persist();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

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

        await storeRef.current.setSelectedScreenshot({
          id: screenshot.id,
          name: screenshot.name,
          file,
        });
      } else {
        await storeRef.current.setSelectedScreenshot(null);
      }
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const handleUploadScreenshot = useCallback(
    async (file: File) => {
      const id = `screenshot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await storeRef.current.setSelectedScreenshot({
        id,
        name: file.name,
        file,
      });
      storeRef.current.clearResults();
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const handleSelectProjectScreenshot = useCallback(
    async (screenshot: Screenshot) => {
      const response = await fetch(screenshot.url);
      const blob = await response.blob();
      const file = new File([blob], screenshot.name, { type: blob.type });

      await storeRef.current.setSelectedScreenshot({
        id: screenshot.id,
        name: screenshot.name,
        file,
      });
      storeRef.current.clearResults();
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const handleClearScreenshot = useCallback(async () => {
    await storeRef.current.setSelectedScreenshot(null);
    storeRef.current.clearResults();
    debouncedPersist();
  }, [debouncedPersist]);

  const setScreenshotDimensions = useCallback(
    (dimensions: { width: number; height: number } | null) => {
      storeRef.current.setScreenshotDimensions(dimensions);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setTemplateImage = useCallback(
    async (dataUrl: string | null) => {
      if (dataUrl) {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const file = new File([blob], "template.png", { type: blob.type });
        await storeRef.current.setTemplateImage(file);
      } else {
        await storeRef.current.setTemplateImage(null);
      }
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setTemplateSource = useCallback(
    (source: TemplateSource) => {
      storeRef.current.setTemplateSource(source);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedStateImage = useCallback(
    (id: string) => {
      storeRef.current.setSelectedStateImageId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedAssetImage = useCallback(
    (id: string) => {
      storeRef.current.setSelectedAssetImageId(id);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSimilarity = useCallback(
    (similarity: number) => {
      storeRef.current.setSimilarity(similarity);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setFindAll = useCallback(
    (findAll: boolean) => {
      storeRef.current.setFindAll(findAll);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSearchRegion = useCallback(
    (region: Region | null) => {
      storeRef.current.setSearchRegion(region);
      debouncedPersist();
    },
    [debouncedPersist]
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
      storeRef.current.setMatches(storeMatches);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSearchTime = useCallback(
    (time: number) => {
      storeRef.current.setSearchTime(time);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setSelectedMatch = useCallback(
    (match: MatchResult | null) => {
      // Find the corresponding store match by comparing region
      if (match) {
        const storeMatch = storeRef.current.matches.find(
          (m) =>
            m.x === match.region.x &&
            m.y === match.region.y &&
            m.width === match.region.width &&
            m.height === match.region.height &&
            m.score === match.score
        );
        storeRef.current.setSelectedMatchId(storeMatch?.id || null);
      } else {
        storeRef.current.setSelectedMatchId(null);
      }
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const clearResults = useCallback(() => {
    storeRef.current.clearResults();
    debouncedPersist();
  }, [debouncedPersist]);

  const setShowMatches = useCallback(
    (show: boolean) => {
      storeRef.current.setShowMatches(show);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setShowScores = useCallback(
    (show: boolean) => {
      storeRef.current.setShowScores(show);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setShowHeatmap = useCallback(
    (show: boolean) => {
      storeRef.current.setShowHeatmap(show);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setHighlightBest = useCallback(
    (highlight: boolean) => {
      storeRef.current.setHighlightBest(highlight);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setZoom = useCallback(
    (zoom: number) => {
      storeRef.current.setZoom(zoom);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const setPanOffset = useCallback(
    (offset: { x: number; y: number }) => {
      storeRef.current.setPanOffset(offset);
      debouncedPersist();
    },
    [debouncedPersist]
  );

  const resetView = useCallback(() => {
    storeRef.current.resetView();
    debouncedPersist();
  }, [debouncedPersist]);

  // Find selected match from ID
  const selectedMatch = (() => {
    if (!store.selectedMatchId) return null;
    const storeMatch = store.matches.find(
      (m) => m.id === store.selectedMatchId
    );
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
